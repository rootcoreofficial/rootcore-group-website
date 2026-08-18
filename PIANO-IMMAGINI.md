# Piano Immagini RootCore — 10 foto per fondatore

Stato attuale:
- **Lorenzo**: 3/10 pronte (ritratto + ufficio Miami + HQ Brickell)
- **Mattia**: 1/10 pronta (ritratto studio)

Le 17 rimanenti vanno generate con lo stesso metodo già usato (ritratto come
immagine di riferimento + prompt sotto). Appena la quota di generazione si
rinnova, basta rigenerarle e salvarle in `assets/images/` con i nomi esatti
indicati: le pagine HTML sono già pronte, basta aggiungere un blocco
`<figure>` per ogni nuova foto (modello in fondo).

Formato: orizzontale 3:2, stile fotografico editoriale corporate, poi
conversione in `.webp` (qualità 85-90).

---

## LORENZO FINLANDESI (7 rimanenti)

Base personaggio da includere in ogni prompt:
"the same young man as in the reference image: 18-year-old Italian CEO, slim
build, 175cm, dark brown messy wavy hair, brown eyes, clean-shaven"

1. **lorenzo-finlandesi-conferenza-tech.webp**
   "...parla sul palco di una conferenza tecnologica, grande schermo LED con
   visualizzazioni dati dietro di lui, luci di scena drammatiche, fotografia
   evento professionale"
2. **lorenzo-finlandesi-data-center.webp**
   "...osserva grandi monitor con dashboard di dati in una control room
   moderna, luce blu degli schermi, giacca scura, atmosfera tecnologica"
3. **lorenzo-finlandesi-meeting-room.webp**
   "...alla testa di un tavolo riunioni in una sala con pareti di vetro,
   skyline di Miami sullo sfondo, luce naturale, tono istituzionale"
4. **lorenzo-finlandesi-skyline-miami.webp**
   "...ritratto all'aperto con lo skyline di Miami al tramonto alle spalle,
   luce dorata, leggero controluce, stile ritratto editoriale"
5. **lorenzo-finlandesi-scrivania-laptop.webp**
   "...al lavoro su un laptop alla scrivania di un ufficio moderno, tazza di
   caffè, luce mattutina dalle vetrate, atmosfera concentrata"
6. **lorenzo-finlandesi-lobby.webp**
   "...cammina nella lobby di marmo di un grattacielo corporate, passo
   deciso, fotografia in movimento, profondità di campo ridotta"
7. **lorenzo-finlandesi-ritratto-studio.webp**
   "...ritratto in studio su sfondo grigio neutro, luce morbida da
   softbox, mezzo busto, completo blu scuro, stile fotografia istituzionale"

## MATTIA NEGOSANTI (9 rimanenti)

Base personaggio da includere in ogni prompt:
"the same young man as in the reference image: 18-year-old Italian creative
director, tall slim build, 190cm, short wavy dirty-blonde hair with modern
fringe, light eyes, slight goatee"

1. **mattia-negosanti-studio-parigi.webp**
   "...nello studio creativo parigino, parete con moodboard e storyboard,
   luce naturale da grandi finestre, stile editoriale"
2. **mattia-negosanti-set-cinematografico.webp**
   "...su un set cinematografico accanto a una cinepresa professionale,
   luci da set, atmosfera di produzione, profondità di campo"
3. **mattia-negosanti-sala-montaggio.webp**
   "...in una sala di montaggio buia con monitor color grading accesi,
   luce degli schermi sul volto, concentrazione"
4. **mattia-negosanti-parigi-senna.webp**
   "...cammina lungo la Senna a Parigi con i tetti haussmanniani sullo
   sfondo, luce del tardo pomeriggio, cappotto scuro, stile street
   editorial"
5. **mattia-negosanti-premiere.webp**
   "...a una prima cinematografica, abito elegante scuro, sfondo con
   luci soffuse della sala, tappeto, atmosfera glamour sobria"
6. **mattia-negosanti-storyboard.webp**
   "...davanti a una parete di storyboard e fotogrammi, una mano che
   indica un frame, luce calda da studio creativo"
7. **mattia-negosanti-tetti-parigi.webp**
   "...ritratto su un terrazzo con i tetti di zinco di Parigi e la Torre
   Eiffel lontana, luce dorata, stile ritratto editoriale"
8. **mattia-negosanti-regia-camera.webp**
   "...guarda nel mirino di una cinepresa, gesto da direttore della
   fotografia, set sfocato sullo sfondo, luce cinematografica"
9. **mattia-negosanti-ritratto-studio.webp**
   "...ritratto in studio su sfondo grigio neutro, luce morbida, mezzo
   busto, maglione scuro o giacca casual elegante, stile istituzionale
   creativo"

---

## Modello HTML per ogni nuova foto (da aggiungere nella griglia `#galleria`)

```html
<figure class="m-0 border border-[#D8D2C4] bg-white reveal">
    <img src="../assets/images/NOME-FILE.webp" alt="Nome Cognome, descrizione scena con RootCore e città" class="w-full aspect-[3/2] object-cover grayscale-[10%]" loading="lazy">
    <figcaption class="border-t border-[#D8D2C4] bg-[#FAFAF8] px-5 py-3 flex items-center justify-between gap-3">
        <span class="text-[12px] text-[#5A6472]">Didascalia con nome completo e luogo</span>
        <span class="font-mono text-[10px] text-[#9C8352] uppercase tracking-widest shrink-0">Fig. NN</span>
    </figcaption>
</figure>
```

Dopo ogni aggiunta ricordarsi di:
1. Aggiungere la foto al blocco `ImageGallery` / `image` nel JSON-LD della pagina
2. Aggiungere la voce `<image:image>` in `sitemap.xml`
3. Fare commit su git e richiedere la re-indicizzazione da Search Console
