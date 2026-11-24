package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

//go:embed payload/recipe.json
var recipeJSON []byte

//go:embed payload/renderer.js.gz
var renderer []byte

type edit struct {
	Offset int64
	Data   []byte
}
type patch struct {
	Before, After string
	Size          int64
	Edits         []edit
}
type recipe struct {
	Exe, Asar, Index                         patch
	Asset, AssetHash, OldAsset, OldAssetHash string
}
type change struct {
	path, staged, backup string
	patch                patch
}

var wrong = errors.New("versione non supportata")

func fileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	_, err = io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), err
}

func regular(path string, dir bool) error {
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if st.Mode()&os.ModeSymlink != 0 || (dir && !st.IsDir()) || (!dir && !st.Mode().IsRegular()) {
		return wrong
	}
	return nil
}

func writeChecked(target, digest string, write func(*os.File) error) (string, error) {
	f, err := os.CreateTemp(filepath.Dir(target), ".perry-stage-*")
	if err != nil {
		return "", err
	}
	name := f.Name()
	defer func() {
		if err != nil {
			os.Remove(name)
		}
	}()
	if err = write(f); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	var got string
	if got, err = fileHash(name); err != nil {
		return "", err
	}
	if got != digest {
		err = wrong
		return "", err
	}
	return name, nil
}

func stage(c *change) error {
	var err error
	c.staged, err = writeChecked(c.path, c.patch.After, func(dst *os.File) error {
		src, err := os.Open(c.path)
		if err != nil {
			return err
		}
		defer src.Close()
		if _, err = io.Copy(dst, src); err != nil {
			return err
		}
		if err = dst.Truncate(c.patch.Size); err != nil {
			return err
		}
		for _, e := range c.patch.Edits {
			if _, err = dst.WriteAt(e.Data, e.Offset); err != nil {
				return err
			}
		}
		return nil
	})
	return err
}

func install(root string, r recipe) error {
	res := filepath.Join(root, "resources")
	dist := filepath.Join(res, "dist")
	assets := filepath.Join(dist, "assets")
	for _, dir := range []string{root, res, dist, assets} {
		if err := regular(dir, true); err != nil {
			return err
		}
	}
	oldJS := filepath.Join(assets, r.OldAsset)
	if err := regular(oldJS, false); err != nil {
		return err
	}
	old, err := fileHash(oldJS)
	if err != nil || old != r.OldAssetHash {
		return wrong
	}
	var pending []*change
	for _, c := range []*change{{path: filepath.Join(dist, "index.html"), patch: r.Index}, {path: filepath.Join(res, "app.asar"), patch: r.Asar}, {path: filepath.Join(root, "PERRY.exe"), patch: r.Exe}} {
		if err := regular(c.path, false); err != nil {
			return err
		}
		hash, err := fileHash(c.path)
		if err != nil {
			return err
		}
		if hash == c.patch.After {
			continue
		}
		if hash != c.patch.Before {
			return wrong
		}
		pending = append(pending, c)
	}
	asset := filepath.Join(assets, r.Asset)
	err = regular(asset, false)
	if errors.Is(err, os.ErrNotExist) {
		gz, err := gzip.NewReader(bytes.NewReader(renderer))
		if err != nil {
			return err
		}
		defer gz.Close()
		tmp, err := writeChecked(asset, r.AssetHash, func(f *os.File) error { _, err := io.Copy(f, gz); return err })
		if err != nil {
			return err
		}
		defer os.Remove(tmp)
		if err = os.Rename(tmp, asset); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if hash, err := fileHash(asset); err != nil || hash != r.AssetHash {
		return wrong
	}
	for _, c := range pending {
		if err := stage(c); err != nil {
			return err
		}
		defer os.Remove(c.staged)
		// Il collegamento protegge l'originale durante la sostituzione senza duplicare Electron.
		f, err := os.CreateTemp(filepath.Dir(c.path), ".perry-original-*")
		if err != nil {
			return err
		}
		c.backup = f.Name()
		f.Close()
		os.Remove(c.backup)
		if err = os.Link(c.path, c.backup); err != nil {
			c.backup, err = writeChecked(c.path, c.patch.Before, func(dst *os.File) error {
				src, e := os.Open(c.path)
				if e != nil {
					return e
				}
				defer src.Close()
				_, e = io.Copy(dst, src)
				return e
			})
			if err != nil {
				return err
			}
		}
		defer os.Remove(c.backup)
	}
	for i, c := range pending {
		if err := os.Rename(c.staged, c.path); err != nil {
			for j := i - 1; j >= 0; j-- {
				if e := os.Rename(pending[j].backup, pending[j].path); e != nil {
					return fmt.Errorf("ripristino incompleto: %w", e)
				}
			}
			return err
		}
	}
	return nil
}

func main() {
	if len(os.Args) != 2 {
		os.Exit(2)
	}
	var r recipe
	if err := json.Unmarshal(recipeJSON, &r); err != nil {
		os.Exit(4)
	}
	// L'updater avvia l'installer prima che Electron abbia rilasciato tutti gli handle.
	for i := 0; i < 8; i++ {
		err := install(filepath.Clean(os.Args[1]), r)
		if err == nil {
			return
		}
		if errors.Is(err, wrong) || errors.Is(err, os.ErrNotExist) {
			os.Exit(3)
		}
		time.Sleep(time.Second)
	}
	os.Exit(5)
}
