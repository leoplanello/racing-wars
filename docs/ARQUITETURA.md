# Arquitetura

```
celulares (/pad) --WebSocket--> servidor Node <--WebSocket-- host (/ , tela principal)
                                  (só relay)                    (simulação + render)
```

- **Host autoritativo**: a simulação roda no navegador da tela principal. O servidor só cria salas, atribui `deviceId` e repassa mensagens.
- **Stack**: Node ESM, `ws`, `three`, `qrcode-generator`. Sem bundler: módulos ES + importmap; libs servidas de `node_modules` (funciona offline na LAN).
- **`sim/` e `shared/`** são JS puro (sem DOM/Three) e rodam no navegador e no Node, por isso são testados com `node --test`.
- **Física realista** (`sim/car.js`: bicicleta dinâmica no plano + corpo rígido de 3 círculos para colisões) com **altitude absoluta** (`car.y`): o carro segue o chão da pista (`track.groundAt`: tabuleiro/rampa/plateau ou terreno), decola quando o chão some mais rápido que a gravidade e pousa. O que sai do chão (carros atingidos, carcaças, pneus soltos) usa **corpo rígido 3D** (`sim/body.js`: quaternion, inércia de caixa/cilindro, contatos por impulso com atrito). Renderizada em 3D com câmera de perseguição (`sim/camera.js`: enquadramento, zoom e regra de corte são matemática pura e testável). Limites da pista via distância assinada até a linha central (sem malhas de colisão, sem tunelamento). Passo fixo de 1/120 s. Aleatoriedade da simulação só via `game.rng`.
- **Casco de colisão** (`HULL` em `sim/car.js`): 6 círculos que cobrem corpo e rodas; os contatos de uma batida são resolvidos juntos por impulsos acumulados (8 iterações).
- **Gelo**: `car.freeze` (timer) trava o rumo e deixa o carro deslizar; o morteiro (`items.mortars`) é balístico e congela a área no impacto.
- **Valores ao vivo**: constantes (`CAR`, `CAMERA`, `WHOMP`...) são objetos mutáveis lidos a cada passo; o editor de debug (`public/host/debug-editor.js`) as edita sem recarregar.
- **Relevo da pista**: `def.hills` (`from`, `to`, `height`, `rise`, `fall`, `rails`) vira `track.ELEV`; `fall: 0` faz uma rampa de salto (empina até o lábio). `track.RAILS` marca onde há cerca. `def.chasms` cria precipícios ao lado da pista (`track.CH`, `track.chasmAt`): quem entra cai e morre. Quem está abaixo do tabuleiro bate na falésia (`track.cliffAt`).

**Terreno e perfil** (montanhas): `profile:[[índiceDoPonto, altura],...]` dá a altura do piso (linear entre os pontos, suavizada) e `hills[].add:true` soma a rampa ao piso (rampa sobre uma descida). `terrain:{box,cell,reach,noise,peaks,zones}` (`sim/terrain.js`, puro) gera uma grade de alturas com a estrada embutida (lado da montanha sobe, lado de fora é falésia, cumeeira nas `zones` `ridge`; desfiladeiro sob as pontes). `track.terrain.heightAt(x,z)`: fora da estrada `groundFromNear(nr,out,x,z)` usa o relevo, então a física dos carros segue a montanha. O terreno cobre o mapa todo (`box`, células de 7 u, ~0,5 s para construir): `rolling` (colinas suaves), `ocean:{shore,polygon}` (mar com fundo em degradê), `rivers` (leito escavado), fossos (`chasms` sem água viram buracos de -45) e o desfiladeiro sob as pontes; **água = terreno abaixo de -1** (`terrain.waterAt`, usada pelo `Game` para afundar o carro) e o terreno nunca passa do tabuleiro de uma ponte. `sceneryOk`/`CORR` mantêm árvores e vegetação fora da pista. O render (`render/terrain.js`) pinta por altura/inclinação (pasto, floresta, cascalho, rocha, falésia, neve, fundo do mar) com textura de detalhe, plano de água (`render/water.js`: material com profundidade por fragmento, duas camadas de ondas e espuma de margem, também usado no rio da Ponte) e vegetação decorativa (pinheiros em bosques, rochas, tufos); o chão do mundo (`world.js`) só existe fora da caixa do terreno.

**Campos de `def` da montanha/praia**: `solidWalls:[{from,to,side}]` (parede sólida num lado mesmo em `openLand`; `track.SOLID`, `hardWall`; o render faz parede de rocha + encosta com neve e o cenário aleatório evita a encosta, `inSolidZone`); `chasms[]` com `gap` (distância da borda até o precipício) e `water:true` (oceano: o render põe água em vez do poço preto); `boxes[].at` (`[fração,'R'|'L'|desloc]`) e `boxRows:[{from,to,every,side,inset}]` (caixas na beirada); `SURF.SAND` (areia, textura `sandTexture`). Rampas de salto (`hills` com `fall:0`) devem ficar em **reta** (antes e depois do lábio): em curva o carro pousa fora da estrada e explode por `offroad` (testado em `test/mountain.test.js`).

**Campos extras de `def`** (pistas urbanas; hoje nenhuma pista própria os usa, o motor continua suportando):
- `widths: [{from,to,hw,blend}]`: meia-largura por trecho (`track.HW`, `hwAt/edgeAt`); o render lê `HW[k]`, não mais uma largura única.
- `openZones: [{from,to,side}]`: sem muro naquele lado (`track.OPEN`, `hardWall(i, d)`): praça, beco, brecha do guard-rail.
- `walls: [{from,to,style}]` e `wallStyle` (`fence|building|jersey|none`): estilo do muro; `building` gera os prédios atrás do muro (`render/city.js`).
- `hills[].skin`: `'truck'` (chassi laranja + rodas) e `'viaduct'` (laje fina + pilares).
- `props` (regras: `{type, every, from, to, side}`) e `objects` (`{type, x, z}` ou `{type, at:[fração, deslocamento|'R'|'L']}`): props urbanos de `sim/scenery.js › PROPS` (poste, semáforo, placa, hidrante, cone, ponto de ônibus, bomba, pilar, caixote, prédio, fonte). O comportamento (`knock`, `solid`, `explosive`, `immune`) fica na tabela `PROPS`; `Game.updatePumps` cuida das bombas.
- `boxes: [{x,z,h}]`: caixas de item avulsas (`h` = suspensa, só quem está no ar pega); `structures`: piso, posto, pórtico (`render/structures.js`).
- `theme`: `kind:'city'`, `sky`, `fog`, `hemi`, `sun`, `exposure` (`scene.applyTheme`). `laps` opcional.

## Logo (exceção a "sem assets binários")

O logo é o único asset binário do projeto: `public/host/logo.png` (256x256, PNG de 256 cores, ~26 KB) e `public/host/favicon.png` (48x48, ~1,4 KB), reduzidos do arte original sem distorcer. As três páginas (`host`, `pad`, `editor`) o referenciam por `/host/...`; `tools/page.js` reescreve para caminho relativo e versionado (`_v/<ver>/`). Na tela principal o `ui.js` monta a URL com `import.meta.url`. Não adicionar outros binários sem registrar aqui.

## Pastas
```
server/index.js        http estático + WebSocket relay + /api/lan
shared/protocol.js     mensagens, codec binário de input, cores
sim/                   rng, track, car, body (corpo rígido 3D), items, game (rodadas/pontos/pneus), ai, camera, scenery (colisores do cenário)
sim/tracks/            definição das pistas (testcircuit, mountain)
public/editor/         editor de mapa (pontos, rampas, materiais, objetos)
public/host/           tela principal (main, net, ui, audio, kbd, debug, debug-editor)
public/host/render/    Three.js: scene (tema), world (pista/cenário), city (prédios/skyline), props, structures, models (picape, semáforo), cars, fx, textures (canvas), water (material de água), details (fauna, flores, placas, bandeirinhas, névoa... só visual, sem colisão)
public/pad/            controle do celular
tools/                 smoke.js, fake-phones.js
test/                  testes node --test
```

## Protocolo
Sala de 4 letras. Host: `{t:'host'}` → `{t:'room', code}`. Celular: `{t:'join', room, clientId, name, avatar}` → `{t:'joined', deviceId, master}`.
O servidor avisa o host com `connect`, `disconnect` e `master`. Host para celulares: `{t:'to', id, data}` e `{t:'all', data}`. Do celular ao host, o servidor embrulha JSON como `{t:'from', id, data}`.

**Input binário** (4 bytes, ~30 Hz + envio imediato em toque): o celular envia `[0x01, steer:int8, botões:u8, seq:u8]`; o servidor entrega ao host `[0x81, deviceId, steer, botões, seq]`. Bit0 = usar item, bit1 = "away" (aba em segundo plano), bit2 = ré (as duas setas juntas).

**P2P (WebRTC)**: a cada `connect` o host abre um `RTCPeerConnection` com o celular e um canal `input` sem ordem nem retransmissão. Oferta/resposta e candidatos ICE vão como `{t:'rtc', sdp|cand}` pelo próprio WebSocket. Com o canal aberto, o celular manda o mesmo pacote de 4 bytes direto para a tela (o indicador mostra "● P2P"); sem canal, segue pelo servidor. Só STUN público, sem TURN.

**Perfil**: o celular manda `{t:'profile', name, avatar}` a qualquer momento fora da corrida (botão "✏️ Perfil"). `avatar` é um emoji ou uma foto JPEG 64x64 em data URL; o servidor valida (`cleanAvatar` em `shared/protocol.js`), guarda na memória e repassa ao host, e o `connect` traz `name` e `avatar` quando o host reconecta. O celular guarda o perfil em `localStorage`.
Menu (Master): `{t:'menu', k:'left'|'right'|'up'|'down'|'ok'|'back'}`.

**Reconexão**: o celular guarda `clientId` em `localStorage`; ao voltar reassume o mesmo `deviceId` (carro, cor, pontos). Se o Master sair, o próximo vira Master.

## Estados do jogo (`sim/game.js`)
`LOBBY → COUNTDOWN → RACING → LAST_STAND (zoom 0,5 s) → COUNTDOWN → … → MATCH_END`.
O fim de rodada só é avaliado em `RACING`, o que evita o falso vencedor no respawn do original.

## GitHub Pages (CI/CD)
- `.github/workflows/deploy.yml`: em PR roda `npm ci`, `npm test`, build e `check:dist`; em push na `main` também publica no Pages.
- `tools/build.js` gera `dist/` a partir dos HTML reais de `public/` (caminhos relativos + importmap, funciona em qualquer subcaminho). `tools/check-dist.js` valida que todo import/href existe.
- Pages é estático (sem WebSocket): o host roda com bots e teclado. Para celulares como controle, hospede o relay (`server/`) em outro lugar e defina a variável do repositório `RELAY_URL` (ex.: `wss://meu-relay/ws`); o build injeta em `window.RW.relay`.
- Requer em Settings > Pages: Source = "GitHub Actions".


## Pistas importadas do SRB2Kart (opcional, so local)
- **Dados**: `tools/srb2kart/` le o instalador do SRB2Kart v1.6 (autoextraivel do WinRAR; nunca e executado). `wad.js`/`map.js`/`soc.js` leem o PWAD `maps.kart` (mapas Doom classicos, lump `SOC_MAIN` com nome/voltas/ceu), `bake.js` converte setores, rampas (linedefs 700-722), pisos 3D (FOF, 100-259), linhas, BSP, largadas, caixas, waypoints e dash pads para unidades do jogo (x = mx*0,06, z = -my*0,06, y = mz*0,06), `nav.js` acha o caminho entre os checkpoints (A* numa grade de celulas dirigiveis, com saltos por molas/dash pads sobre buracos), `centerline.js` suaviza/recentra e reamostra a 1 u, `assets.js`/`png.js` decodificam flats e texturas (patches + lump `TEXTURES`) para PNG.
- **Simulacao**: `sim/mapworld.js` (setor de um ponto pela BSP, superficie alcancavel com degrau de 24*0,06 u, linhas por grade espacial) e `sim/maptrack.js` (reaproveita `buildTrack` para a linha central de progresso/IA/camera e acrescenta `track.map`). `sim/car.js` troca o chao, as paredes (linhas do mapa) e os pisos especiais (fora de pista 1-3, painel de sneaker, mola, dash pad, poco/morte) quando `track.map` existe. Pistas de mapa nao explodem por sair da estrada; o fora de pista e so lento.
- **Render**: `public/host/render/mapworld.js` monta uma malha por textura (pisos/tetos, paredes superior/inferior/meio com o alinhamento do Doom, topo/base/lados dos FOFs, agua translucida).
- Os arquivos gerados (`public/tracks/srb2kart/`, `local-assets/`) estao no `.gitignore`; sem eles o jogo funciona normalmente e os testes `test/maptrack.test.js` sao pulados.
- **Corrida e campeonato**: `main.js` (`startGame`, `nextRace`, `preloadNext`) cria o `Game` em `mode:'race'` para pistas de mapa; `sim/champ.js` (puro) guarda a playlist e os pontos acumulados; `ui.raceResults` mostra o resultado e a classificação geral. A pré-carga baixa o JSON da próxima pista e aquece o cache das texturas (`preloadMapAssets`).
- **Miniaturas**: `shared/thumb.js` desenha o traçado em SVG a partir de `def.points` (pistas locais, em código) e `node tools/srb2kart/thumbs.js` grava `public/tracks/srb2kart/thumb/<id>.svg` e o campo `thumb` do `index.json` (rodar depois de `build.js`).
- **Pistas jogáveis**: `node tools/srb2kart/validate.js` roda 8 bots em cada pista e grava `playable`/`issue` no `index.json`; o menu só lista as `playable`. O contato de parede (`sim/car.js mapContacts`, `sim/mapworld.js nearestWall`) mede o degrau na altura do carro no ponto de contato, senão o topo de uma rampa parece uma parede (era o encalhe do MAP02).
- **Pendente**: modo Batalha (as arenas `MAPB*` não têm waypoints; precisam de build próprio, largadas por `thing 33`, IA de arena e pontuação); 6 pistas não geram (MAP10, 14, 16, 30, 55, 57: sem caminho entre checkpoints, por exemplo, o MAP55 tem trecho de poço de morte); projeto Unity em `tools/unity/` para assets 3D (o `unity` CLI e o Editor 6000.6.4f1 estão instalados).
- **Objetos (sprites)**: `objects.js` extrai da `info.c` do codigo-fonte a tabela doomednum -> estado de spawn -> sprite/quadros/tamanho; `assets.js#sprite` decodifica o patch (com o deslocamento) dos lumps S_START..S_END do `srb2.srb`/`gfx.kart`. Os `things` viram `props` (altura = piso do setor + Z do thing, ou teto - altura se virado; plateia 1488 = chao AUDI no dobro do tamanho) e o host os desenha como billboards instanciados (so em torno do eixo vertical, com luz do setor e neblina). Aneis nao existem no SRB2Kart.
- **Ferramentas de engenharia reversa avaliadas** (não usadas): Cpp2IL só serve para jogos Unity IL2CPP; ghidra-mcp (Ghidra + Java 21) só ajuda com binários sem fonte (SRB2Kart e mk64 têm código-fonte); rea não roda no Windows (macOS/Linux).

### Pistas do SRB2Kart: correções e ferramentas de teste (rodada de correção)
- **Linha central** (`tools/srb2kart/centerline.js`): o `y` segue o nível do caminho do A* (`MapWorld.surfaceNear`), em vez de despencar para o piso de baixo quando a suavização tira o ponto da plataforma (era a causa do respawn no vazio em loop). `nav.js` não trata mais penhasco como chão (queda livre custa caro, `MAX_DROP`); `build.js` registra os saltos de rampa como `assists` (a IA mira neles).
- **IA** (`sim/ai.js`, só pistas de mapa): `track.AIR` marca trechos de salto (não freia nem muda de faixa); freia pela curvatura (`AI.latAccel`); engata ré quando bloqueada; mira respeitando paredes (`segmentWalled`); alinha ao gatilho do assist; afasta-se da parede real (`nearestWall`); corredor estreito = linha central; zera o estado no respawn (`car.respawns`).
- **Render** (`public/host/render/mapworld.js`): linhas de mesmo setor desenham a textura do meio (grades/cercas); o meio de linhas de dois lados vale uma vez na altura da textura (sem esticar); textura/flat ausente = cinza neutro (nunca cor aleatória), nomes de som/número ignorados; `F_SKY1` em piso 3D não é desenhado; paredes internas duplicadas de piso 3D são puladas; tetos e bases de piso 3D só se veem por baixo (a câmera aérea enxerga os carros); halo de textura transparente corrigido em `assets.js bleedAlpha`; céu com a imagem `SKYn` (`scene.js setSkyImage`). `cars.js` não limita mais a altura do carro em -8 em pistas de mapa (carros em pisos abaixo de zero apareciam flutuando).
- **Ferramentas**: `check-center.js` (linha central sobre vazio/morte e nível errado), `hotspots.js` (agora também conta respawns por causa e loops), `validate.js` (limite de tempo maior em pistas longas). Depois de mexer em `assets.js`/`centerline.js`/`nav.js`: apagar `public/tracks/srb2kart/tex`, `node tools/srb2kart/build.js race`, `thumbs.js`, `validate.js`.
- **Texturas animadas e efeitos**: `assets.js parseAnims` lê o `ANIMDEFS` (flats e texturas em ciclo: água, lava, cachoeiras, luzes); `build.js` exporta todos os quadros e grava `d.anim`; `mapworld.js` troca o quadro por `update(time)` (35 tics/s). Água usa o flat do topo do setor de controle, translúcida; pisos 3D 140-142 e intangíveis decorativos (220-222) são translúcidos (223 e os com special de setor ficam invisíveis); paredes 500/501 rolam; a luz é elevada a 1,6 (o jogo escurece em espaço de gama).
- **Assists**: cada salto assistido guarda `f` (fração da volta): o gatilho só dispara para quem está nesse trecho da pista e anda para a frente (pistas que se cruzam têm outra perna passando pelo mesmo ponto). A IA mira neles.
- **Estado**: 51 de 54 pistas geradas são jogáveis (ainda falham MAP29, 50 e 59; algumas levam mais de 7 min por volta por causa dos reinícios gerais) e as 6 que não geram (MAP10, 14, 16, 30, 55, 57).
