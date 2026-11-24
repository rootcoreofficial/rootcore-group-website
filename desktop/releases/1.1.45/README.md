# PERRY Desktop 1.1.45

Aggiornamento di «Riprendi» per le installazioni ufficiali Windows x64 della 1.1.44, comprese quelle che hanno già applicato la correzione manuale. Il pacchetto contiene il renderer e le modifiche ai metadati di versione di Electron. Controlla gli hash di ingresso e di uscita e conserva i fuse e il controllo di integrità ASAR. Il server già installato e i dati dell'utente rimangono sul PC.

Il test Windows usa la 1.1.44 ufficiale e un feed HTTP di loopback. Controlla il download dall'updater, applica il file dalla cache alla cartella registrata, verifica gli hash dell'installazione, avvia la 1.1.45 e verifica che il secondo controllo la riconosca come aggiornata.

Il manifest nella cartella serve ai test con file adiacenti. Se il manifest pubblico è servito da una release diversa da quella dell'aggiornamento, gli URL del pacchetto devono essere assoluti e puntare al tag della 1.1.45. Il pacchetto incrementale richiede la base ufficiale 1.1.44. Il sito continua a offrire il programma completo ufficiale 1.1.44. Quando incontra una versione precedente registrata, l’aggiornamento riapre il suo updater sul canale storico 1.1.44. Al successivo avvio normale il client torna al canale pubblico. Il collegamento di compatibilità PERRY-Setup.exe apre il download completo per le prime installazioni.

Per ricompilare, nella cartella src eseguire su Windows x64 `go build -trimpath -ldflags="-s -w -H=windowsgui" -o apply.exe .` e poi `makensis update.nsi`. Rigenerare il file blockmap e il manifest quando cambiano i byte del pacchetto.

Per il rollback del canale ripristinare il manifest della 1.1.44. I client che hanno già ricevuto la 1.1.45 possono reinstallare la versione ufficiale 1.1.44. Questa procedura conserva il profilo desktop.
