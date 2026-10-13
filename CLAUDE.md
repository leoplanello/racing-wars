# Racing Wars

Jogo web: host (tela principal) + celulares como controle. UI em português (pt-BR). Regras em `docs/REGRAS.md`, arquitetura em `docs/ARQUITETURA.md`.

## Comandos
- `npm start`: servidor em http://localhost:3000
- `npm test`: testes da simulação (`node --test test/`)
- `npm run smoke`: teste de rede com host e 8 celulares falsos

## Convenções
- `sim/` e `shared/` não podem importar DOM, Three nem APIs só do Node: rodam nos dois ambientes.
- Simulação determinística por passo fixo (`DT = 1/120`); o render só lê o estado.
- Nada de assets binários: modelos, áudio e QR são gerados em código.
- Ao mudar regras, atualize `docs/REGRAS.md` e os testes em `test/`.
- Editor de mapa dedicado em `/editor/` (`public/editor/`); salva em localStorage e o jogo usa com `?debug`.
- Debug: `?debug` ou F3; F4 abre o editor (valores ao vivo, pista, seleção de área para pedir edições); V congela.
- `node tools/dyn.js` inspeciona a dinâmica do carro; `node tools/balance.js [bots] [copa] [pista]` simula partidas só com bots (pista: `test` ou `mountain`).
- Câmera: tecla C (lobby e partida) alterna entre o estilo atual e a tela dividida com câmera de kart por jogador (`KartCamera`, `shared/layout.js`); é só visual.
- **SRB2Kart** (dados locais, nunca versionados): `node tools/srb2kart/extract.js` extrai do instalador (`other-games/Kart-Public-1.6/*.exe`, via UnRAR) para `local-assets/srb2kart/`; `node tools/srb2kart/build.js race` gera `public/tracks/srb2kart/*.json` + texturas PNG (`index.json` lista as pistas e o menu as carrega sozinho). Ferramentas de diagnostico: `list.js`, `preview.js MAPxx` (SVG), `route-test.js`, `sim-test.js <id>`, `debug-point.js`. A fisica de mapa vive em `sim/mapworld.js` + `sim/maptrack.js` e os ganchos `track.map` em `sim/car.js`.
- Pistas SRB2Kart no menu: a pasta "Pistas Sonic" so aparece com o debug ligado (F3 ou `?debug`); so as `playable` (`node tools/srb2kart/validate.js` atualiza); `node tools/srb2kart/thumbs.js` gera as miniaturas; ▲▼ no seletor de pistas escolhe o campeonato (1/3/5 pistas, `sim/champ.js`).
- Atalho de teste: `/?debug&track=mountain&autostart` abre a partida direto; `/editor/?track=mountain` edita a pista.
- Objetos do SRB2Kart (cenario, molas, plateia): `tools/srb2kart/objects.js` le a `info.c` do codigo-fonte em `other-games/` (doomednum -> sprite/quadros); `build.js` grava `props`/`propTypes`/`spr` na pista e os sprites em `tex/s_*.png`; o render (`buildProps` em `public/host/render/mapworld.js`) desenha billboards instanciados. O SRB2Kart nao tem aneis. `node tools/srb2kart/check-tex.js MAP01 ...` lista texturas/flats que faltam.
- **Servidor/deploy**: varias salas simultaneas (codigo de 4 letras; `MAX_ROOMS`, limite de salas novas e de chutes de codigo por IP). O servidor entrega HTML com caminhos relativos (`tools/page.js`) e o WebSocket sai de `shared/wsurl.js`, entao o jogo roda na raiz e atras de proxy com prefixo (`/racing-wars/`). Producao: `Dockerfile` + `deploy/stack.yml` (Swarm/Traefik do repo privado `leoplanello/infra`): racing-wars.leoplanello.com e leoplanello.com/racing-wars/. A imagem nao leva os mapas SRB2Kart. `replicas: 1` (salas ficam em memoria).
