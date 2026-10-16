# Regras do jogo

## Objetivo
Ser o último carro vivo em cada rodada e chegar a **20 pontos**, ou ter mais pontos quando o líder completar **3 voltas**.

## Câmera e eliminação
- Câmera de **perseguição** alta, mas ainda inclinada (44°; ajustável no debug), sempre **atrás** do pelotão. A câmera segue a **média de todos os carros** (posição, velocidade e rumo da pista no ponto médio), com a âncora baixa na tela para mostrar **bastante pista à frente**; o zoom afasta para caber o primeiro e o último carro. A câmera dá zoom out para caber o último carro, até um **limite fixo**; ela sobe e desce com o terreno (rampas, plateau) e não treme com as batidas: a âncora segue o líder devagar na lateral, o rumo e o zoom têm zona morta, e o tremor de explosões é suave e tem teto.
- Passando do limite, a câmera favorece o líder. **Ninguém é eliminado por estar na frente**; só explode quem fica para trás (sai pela borda de baixo).
- Carros que **saem muito da estrada** (em terra aberta, mais de ~28 unidades da borda) **explodem**. Dá para sair e explorar o cenário, mas árvores, pedras e casas são sólidas e as cercas quebram. Na ponte as vigas são sólidas; cair no rio afunda o carro.
- **Carros explodidos viram carcaças** que ficam no mapa (escuras, soltando fumaça) e **continuam sólidas**: batem nos outros, no cenário e nos muros até o próximo spawn. A carcaça **mantém a velocidade** do carro (o motor "preso" ainda empurra ~1 s), é **~2,5× mais pesada** e capota e rola pela física, sem animação fixa. Os 4 **pneus saem do carro** como corpos físicos (veja Efeitos).
- **Retardatário acelera**: quem está perto de sair do quadro (por trás) ganha até **+20%** de velocidade até voltar para perto do centro da tela. O líder não recebe o bônus.
- Um marcador pulsante avisa que um carro está perto de ser cortado ou de se perder no mato.
- **Câmera: estilo atual ou tela dividida (kart).** No lobby há a opção "Câmera" e a tecla **C** alterna (também durante a partida); a escolha fica salva no navegador (`rw-camera-mode`). Na **tela dividida** cada jogador humano (celular ou teclado) ganha uma célula com a **câmera tradicional de jogos de kart**, atrás do próprio carro (`KartCamera` em `sim/camera.js`, com os valores do SRB2Kart: 160 atrás, 82 acima, mira 64 à frente, filtros de rumo/altura/inclinação, deslocamento lateral na derrapagem, aproximação com nitro, recuo em alta velocidade). Layout: 2 jogadores = uma célula em cima da outra; 3-4 = 2×2; 5-6 = 3×2; 7-8 = 3×3 (a célula livre mostra a classificação). Bots não ganham célula; sem humanos, volta ao estilo atual. Quem morre passa a acompanhar o líder. Cada câmera **não atravessa paredes nem objetos**: se há parede (`MapWorld.nearestWall`), objeto do cenário ou muro entre o kart e a câmera, ela se aproxima na hora e volta devagar quando livre (`camBlocked`); a câmera de cima (só na posição de render `vx/vy/vz`; o enquadramento e o corte seguem a posição das regras) se aproxima da mira pelo mesmo critério. Nenhuma das duas fica **acima de teto** (setor sem céu aberto ou base de piso 3D que cobre o carro), atravessa parede nem entra em objeto do cenário (`camFrac`/`camBlocked` em `sim/camera.js`, `MapWorld.solidAt`). **É só visual**: as regras (corte de quem fica para trás, pontos) continuam na câmera compartilhada, e cada célula mostra "VOLTE PARA O PELOTÃO!" quando o carro está perto de ser cortado. Com 5 ou mais células a sombra do sol é desligada (ela seria renderizada uma vez por célula). A freecam do debug sempre usa tela cheia.

## Rodadas
1. Contagem regressiva **3-2-1-GO**; carros travados até o GO.
2. Rodada em andamento: mortos ficam de fora (sem respawn individual).
3. Quando sobra **1 carro vivo** (ou 0), o jogo congela, a câmera dá um zoom rápido no sobrevivente por **0,5 s**, e os pontos são aplicados.
4. Nova contagem 3-2-1: **todos renascem ao mesmo tempo**, na pista, um pouco **antes** de onde o sobrevivente estava.

## Bots
Três dificuldades, escolhidas no lobby (**G** ou ▲▼; no celular Master, ▲▼):
- **Fácil**: lento, mais ruído, reflexo mais lento e **o bot que está na frente comete erros** de vez em quando (sai da linha ou "dorme" numa curva). Além disso, se um bot fica **mais de 5 s na frente** do grupo (só quando não há jogador real), ele **alivia o ritmo** até o grupo chegar perto (`DIFFICULTY.easy.rubber`).
- **Fácil e Médio — bot à frente dos jogadores reais**: o bot que abre vantagem sobre o jogador humano mais adiantado (Fácil > 0,8 s, Médio > 1,3 s) **reduz a velocidade** (60% / 75% do cruzeiro) até o humano chegar perto (`rubber.humanGap`, `rubber.humanThrottle`). No Difícil não há essa ajuda.
- **Todos os bots** desviam de carros (inclusive na mesma velocidade, e lado a lado) e têm **controle alto na largada** (reflexo rápido e desvio reforçado nos primeiros segundos).
- **Médio**: o padrão.
- **Difícil**: preciso, antecipa mais, usa itens cedo e quase não erra.
Os bots seguem a linha de corrida (por dentro das curvas), desviam de carros, carcaças, pneus soltos, minas e árvores, evitam a borda do plateau e do precipício, **seguram a faixa da vaga na largada e no spawn** (largada organizada) e escolhem faixas menos cheias.

## Pontuação
Todos começam com **5** pontos (mínimo 0, máximo 20).

| Situação na rodada | Pontos |
| :--- | :---: |
| Sobrevivente | +2 |
| Penúltimo a morrer | +1 |
| Primeiro a morrer | −2 |
| Demais mortos | −1 |

Com 2 jogadores: sobrevivente +2, outro −2. Se os últimos caírem juntos, o último a morrer conta como sobrevivente.
**Fim da partida**: alguém chega a 20 (vitória imediata) ou o líder completa 3 voltas (vence quem tem mais pontos; desempate pela ordem de chegada). A volta de todos passa a ser a do sobrevivente a cada nova rodada.

## Carros e física
- Picapes 4x4 de brinquedo, ~30% menores que na v0.2, em pistas largas.
- **Hitbox**: o casco de colisão é de 6 círculos (~3,6 × 2,56 u) e cobre o corpo **e as 4 rodas**: carros lado a lado, ou batendo roda com roda, não se atravessam. Pneus soltos também são sólidos (têm hitbox).
- **Tração 4x4, direção dianteira**: modelo de bicicleta dinâmico com pneus que saturam. O motor empurra os dois eixos (`CAR.frontDrive` = 25% na frente) e cada eixo consome o próprio atrito lateral, então acelerar forte em piso escorregadio ainda faz o carro escapar, mas arranca mais rápido. Há um controle de tração que tira o pé quando o carro derrapa. **Drift estável**: em curva forte (volante > ~55%) e acima de ~22 u/s a traseira perde até 20% da aderência (`CAR.driftLoss`), deixando o carro rodar de lado (deslize de ~12–14°, giro ~30% mais fechado que a curva de aderência). Sem um limite, essa perda criava um giro descontrolado: o torque de guinada nunca zerava, o ângulo de deslize passava de 30°, o giro dobrava, a velocidade caía e o carro levava ~1,7 s para voltar. Por isso há três travas: (1) **auto-limite** — a perda encolhe conforme o ângulo de deslize cresce (plena até `CAR.betaLo` 0,14 rad, nenhuma em `CAR.betaHi` 0,35 rad), o que dá um equilíbrio estável; (2) **contra-esterço** — volante para o lado do deslize devolve a aderência da traseira na hora (a inversão do giro leva ~0,13 s); (3) amortecimento do giro pelo ângulo de deslize (`CAR.slipDamp` 25). A perda entra e sai aos poucos (`car.drift`, sem degrau); o controle de tração só tira parte do pé (mínimo 55%); com nitro o efeito cai a 40%. **Direção em velocidade**: o auxílio de direção limita o volante pela aderência (`CAR.gripAssist` 1,4 × `mu` × `CAR.g` 75), o que dá, com esterço total em cruzeiro (42 u/s), raio ~21 e giro de ~1,7 rad/s (antes 29 e 1,3); as pistas pedem raio mínimo de 18 a 21. `node tools/dyn.js` mostra raio × velocidade. Pneus firmes (saturação menor). `node tools/dyn.js` mostra o cenário (deslize, recuperação e inversão). **Batida lateral escorregadia**: o atrito entre carros é mínimo (`CAR.carFriction`) e, em contato de lado, os dois ganham um empurrão leve para se afastar (`CAR.sideSlide`), então um não fica grudado no outro.
- Direção **rápida e sensível** (o volante vira com facilidade e o carro tem mais aderência e controle; no celular a seta leva o volante ao máximo em ~0,05 s e a curva do volante é mais sensível perto do centro).
- Quem é atingido (whomp, batidas) **gira de verdade** e fica virado para onde parou: **não há auto-correção** do rumo.
- **Roda traseira**: bater na traseira de um carro faz ele perder aderência atrás por ~0,5–1 s e rodopiar com facilidade.
- O ângulo do volante é limitado pela aderência (auxílio de direção): só esterçar não faz o carro rodar.
- **Colisões de corpo rígido**: cada carro tem massa e inércia. Bater por trás empurra o da frente, bater de lado o faz girar, raspar no muro gira o carro. Carro em nitro é bem mais pesado (`CAR.boostMass`): empurra quem está na frente para trás do enquadramento, eliminando-o. **Carros encostados não se prendem** (só encosto de frente aciona a ré de desengate; de lado, o carro desliza e se solta). **Bater na roda de trás de um carro o faz girar** (`CAR.rearSpin`, F4): a separação usa a normal média de todos os círculos em contato, o atrito entre carros é baixo, o contato aciona a ré de desengate e carcaça empurrada acorda.
- **Nitro = alto controle**: com nitro a aderência (`CAR.boostGrip`) e o esterço em alta velocidade (`CAR.boostSteer`) aumentam e a tração toma menos do círculo de atrito: o carro não escorrega.
- Se o carro fica de frente para o muro, engata ré por um instante e sai.
- **Altura de verdade**: o carro tem altitude, gravidade e estado **no ar** (sem tração nem esterço, só inércia). Em rampas ele decola com a velocidade vertical da subida; **o carro nunca entra no chão**. Pouso muito forte (queda do plateau) capota; o impacto é medido relativo ao piso (normal da superfície) e quem decolou de uma rampa aguenta um pouso ~35% mais forte, então saltos de rampa não capotam. Carros em alturas diferentes não se tocam, e quem está no chão **bate** na lateral de uma área alta em vez de subir nela.
- Superfícies: asfalto (aderência 1,0), pedra (0,95), terra e madeira (0,85).

## Copas
| Copa | Caixas de item | Foco |
| :--- | :--- | :--- |
| Fast Cup | nenhuma | condução limpa |
| Super Cup | moderadas | corrida + itens |
| War Cup | muitas | combate |

## Itens
Caixotes de madeira com símbolo azul brilhante (grupos de 5 na War Cup e de 3 na Super Cup) dão um item **sorteado de forma uniforme**, um por vez. O poder guardado **fica montado no carro** (visível para todos) até ser usado. No celular, toque no botão de ação.
- **Míssil** (míssil armado no teto): muito rápido e **sempre em linha reta** (não persegue). O carro atingido **explode**. Quem está na linha de tiro ouve um alarme e o celular vibra.
- **Nitro** (turbina atrás + aerofólio grande): ~2 s de velocidade muito alta. Não dá invulnerabilidade. Deixa um **rastro de fogo curto e colado no carro** (~0,3 s, uns 15 u): qualquer outro carro que cruzar o rastro **explode** (o dono é imune). A **turbina e o aerofólio ficam montados até o nitro acabar**.
- **Magnético** (cubo azul em cima do carro): onda de choque de **curto alcance** com força **exponencial** na distância (`F = P·e^(−d/λ)`). Quem está colado é empurrado e dá um **pulinho** (sai do chão); **alcance grande (~30 u)** e força bem maior (`WHOMP`); só na borda do alcance quase não sente. O carro **mantém o rumo**: não entra em atordoamento nem rodopia (giro limitado); só carcaças e pneus soltos recebem o impulso físico completo. Ganha domo de energia, anéis e raios elétricos.
- **Poderes afetam o cenário**: míssil, bomba e Whomp (até `WHOMP.sceneryRadius`) **derrubam árvores e pedras** (o colisor some; voltam na rodada seguinte) e **quebram cercas** no raio; o míssil explode ao bater em árvore/pedra/casa; o gelo deixa o cenário azulado. Casas resistem. Whomp: `push` 160, `maxSpin` 1.7.
- **Velocidade dos poderes**: `POWER.speedScale` (F4 › Itens) multiplica a velocidade de míssil, onda do Whomp e morteiro.
- **Canhão de gelo** (canhão sobre o teto do carro enquanto equipado): lança uma bola de gelo como **morteiro, em arco bem alto** (`ICE.lob` = altura do arco; `ICE.flight` = tempo mínimo de voo) que cai **35 u à frente** (`ICE.range`). No impacto, todos os carros num raio de `ICE.radius` (13 u, menos o dono) ficam **congelados `ICE.time` s** (4 s) dentro de um **cubo de gelo** (soltando água ao deslizar — só visual): sem esterço, sem tração e sem item, **rumo travado**. O carro congelado **mantém a velocidade que tinha e vai desacelerando até 85% da velocidade normal** (`CAR.iceKeep`, `CAR.iceDecel`) — nunca abaixo disso. O cubo se estilhaça ao fim; mina, míssil e rastro ainda explodem o carro congelado. Árvores e pedras no raio ficam azuladas.
- **Mina** (mina no teto): fica **parada exatamente onde foi ativada** (posição e altura; no ar ela fica suspensa e só pega quem passa na mesma altura, `POWER.mineReachY`). O dono só a aciona depois de sair de cima dela. **Quem a tocar com qualquer parte do casco explode.** Se ao ativar houver um carro **encostado na TRASEIRA** do carro com a bomba (atrás dele, tocando as hitboxes traseiras; `POWER.mineTouch`), ele explode na hora e a mina não é largada. Carro ao lado ou à frente não conta.

## Pistas
Itens: nitro, mina, míssil, magnético e gelo (sorteio uniforme entre os cinco).

Pistas disponíveis: **Ponte do Rio** (teste) e **Passo da Montanha**, mais a pasta **Pistas Sonic** (SRB2Kart). Planejadas: Water Hill, Death Mountain, Farm Jump.

### Ponte do Rio (teste)
~1,5 min por volta: ponte de madeira com vigas de aço sobre o rio, estrada de terra com sulcos entre cercas de ferro, um zigue-zague de **curvas fechadas** na praça de paralelepípedo, **2 rampas de salto** uma **área alta (plateau) sem guardrails** de onde é possível cair e um **precipício** ao lado da pista (fosso fundo, sem cerca, na parte externa da curva grande do leste): sem cercas na beira. Quem cai **não morre na hora**: despenca (visível) e é eliminado ao **sair do enquadramento** da câmera (ou após `RULES.chasmFallMax` = 3 s).

### Passo da Montanha (~3,4 min por volta, ~7,9 mil u)
Mesmo estilo da Ponte do Rio, numa serra (tema `kind:'mountain'`: céu frio, picos com neve, pinheiros). A volta é **horária**. Em ordem: ponte de madeira no desfiladeiro da largada, **garganta estreita**, subida até um patamar, **grampos de serra** em pedra com **duas rampas de salto** (em reta: o carro decola reto e pousa na estrada), precipícios nas curvas, **platô alto no cume sem guardrails** de onde é possível cair e, no fim da volta, três trechos:
1. **Praia e costa oeste**: reta de areia (`SURF.SAND`, um pouco menos de aderência) com o **mar à esquerda**; o **oceano cobre todo o lado oeste do mapa** (do sul da borda oeste até o noroeste), com fundo que desce da areia ao azul-escuro e **ondas** (espuma animada) que sobem até a areia. Cair no mar (ou em qualquer água) elimina o carro. Só palmeiras e sem arbustos na praia. Na planicie noroeste corre um **rio** que desagua no mar.
2. **Montanha A**: uma montanha de verdade, com **pico** (~100 u). A estrada sobe em **espiral de 2 voltas à esquerda** (piso de 0 a ~58 u): **montanha (parede sólida) à esquerda**, **queda à direita** (falésia: quem sai da estrada cai no terreno de baixo e é eliminado por sair da pista) e **caixas na beirada da queda** (`boxRows`).
3. **Ponte alta e montanha B**: do cume a ponte reta segue por cima das voltas de baixo e de um desfiladeiro (com rio) até o topo da **montanha B**; curva larga, **descida reta sem voltas** com uma **rampa de salto** e a curva final para a largada.

## Modo corrida (pistas do SRB2Kart)
- As pistas importadas do SRB2Kart rodam em `mode:'race'` (`sim/game.js`): corrida clássica de N voltas (`track.def.laps`, de 2 a 5), sem rodadas (sair do quadro da câmera explode o carro, como na sobrevivência, exceto o líder). As pistas locais (Ponte do Rio, Passo da Montanha) seguem na sobrevivência.
- **Chegada**: quem completa as voltas ganha a colocação (evento `finish`). A corrida acaba quando todos chegam ou 30 s depois do primeiro (`RULES.finishCountdown`); quem não chegou fica por progresso.
- **Pontos da corrida** (`RACE_POINTS`): 10, 8, 6, 5, 4, 3, 2, 1 do 1º ao 8º; depois, 0.
- **Câmera**: a mesma câmera compartilhada da sobrevivência: enquadra o pelotão (média dos carros vivos que não estão despencando, zoom até `hMax`) e segue o rumo da pista pelo progresso médio. Quem sai da área da câmera (por trás ou pelos lados) **explode** (`cut`), exceto o líder, depois de `cutGrace` segundos do GO; o reinício geral que se segue põe todo mundo junto de novo.
- **Reinício geral com semáforo**: carro que cai, explode (inclusive por corte da câmera) ou fica preso/perdido (`stuckTime`, `lostTime`, `watchDist` em `watchTime` — esses **explodem**, causa `stuck`) fica de fora como carcaça. Quando **sobra só um carro vivo** (e as carcaças já assentaram, `respawnAfter`; mínimo `regroupCooldown` = 4 s desde o último GO), todos os carros que ainda não terminaram são recolocados juntos numa grade `regroupAhead` (8 u) à frente do sobrevivente (em chão firme), ordenados pelo progresso, invulneráveis por `shieldTime`, e o semáforo 3-2-1 roda de novo (`countdown`/`go`; eventos `respawn` com `cause:'regroup'`). Voltas, progresso e tempo da corrida continuam. `Game.respawn` (ponto seguro individual) segue existindo para debug/testes.
- **Campeonato** (`sim/champ.js`): no seletor de pistas, ▲▼ escolhe 1, 3 ou 5 pistas; a playlist é a pista escolhida e as seguintes da lista (voltando ao começo). Depois de cada corrida aparecem o resultado e a classificação geral; OK vai para a próxima pista (já pré-carregada durante a corrida). Desempate: mais vitórias, depois melhor colocação na última pista.
- **Menu**: as pistas do Sonic ficam numa **pasta** ("Pistas Sonic"): OK abre, VOLTAR sai (a raiz mostra só as pistas próprias). Só aparecem as pistas que os bots completam (`playable` em `public/tracks/srb2kart/index.json`, gravado por `tools/srb2kart/validate.js`); com `?track=<id>` a pista pedida entra mesmo assim, para teste. Cada pista tem miniatura do traçado (`thumb`).
- Batalha (arenas `MAPB*`) ainda não existe: ver `docs/ARQUITETURA.md`.

## Efeitos
- Cercas (brancas e de ferro) **se estilhaçam** com física: tábuas e postes voam na direção do carro, quicam e somem; árvores soltam folhas e pedras soltam lascas.
- Carros explodidos recebem um impulso do epicentro fora do centro de massa e **capotam em 3D pela física** (corpo rígido com contato dos cantos da caixa com o chão). Soltam destroços (portas, para-choques), bola de fogo, coluna de fumaça, marca queimada e luz. Os **pneus viram corpos físicos** (cilindros): herdam velocidade e giro, quicam, **rolam** pelo mapa, **colidem** com carros, carcaças, cenário e muros e ficam até o próximo spawn. O whomp arremessa com arcos elétricos.
- Controle do celular de quem morreu mostra só uma **caveira** até o próximo spawn.

## Modo debug
`?debug` na URL ou tecla **F3** abre o painel em qualquer fase: corrida infinita (mortos renascem junto do pelotão), sem corte, imortal, freecam (WASD move, Z/Q sobe/desce, arrastar o mouse; enquanto ligada o carro humano dirige como bot; velocidade em F4 › Freecam: `FREECAM.speed`/`fast`), dar itens (1–5), slow-mo (T), **freeze** (V congela a simulação; `.` avança 1 quadro), hitboxes (H, inclui as rodas), renascer (R) e explodir bots (X). Nada disso afeta a partida com o painel fechado.

**Editor (F4)**: painel com todos os valores numéricos ao vivo (cada valor tem um **↺** para voltar ao original e um texto de ajuda ao passar o mouse; botões **Itens** dão o item ao jogador, inclusive o gelo) (câmera com ajuste fino, carro, itens, regras, IA e dificuldades), salvos no navegador, com "Copiar mudanças" (JSON) e "Resetar tudo". A seção **Pista** edita tamanho, largura, colinas, precipícios, superfícies, pontes, pontos de controle, caixas e a quantidade de cenário, e **Aplicar pista** reconstrói tudo. **Seleção de área (E)**: arraste um retângulo no chão; o painel mostra coordenadas, trecho da pista (fração da volta e metros), definições e objetos dentro, com "Copiar descrição" e um campo de nota para colar na conversa e pedir a edição.


## Largada e destroços
- Ninguém nasce dentro de outro carro: a grade tem espaçamento maior, o respawn do debug usa vagas distintas e a contagem regressiva separa qualquer sobreposição antes do GO.
- Pneus, carcaças e detritos que saem da pista sobre um **precipício ou rio** caem e somem (não flutuam).

## Editor de mapa
Página dedicada em **`/editor/`** (no Pages: `editor/`). Mostra a pista real em 3D (mesmo render do jogo). Botão esquerdo usa a ferramenta; direito gira; Shift/botão do meio/arrastar o fundo move; roda dá zoom; WASD move; **F** enquadra; **Delete** remove a seleção.
**Ferramentas visuais**: Rampa (9), Ponte (0), Precipício (C) e Piso (P) — clique no início e no fim sobre a pista; o trecho criado já vem selecionado com alças arrastáveis (verde início, vermelha fim, amarela **altura** da rampa, laranja subida/descida). Pontos, caixas, alças e campos numéricos atualizam a pista, as cercas e o semáforo **em tempo real** (reconstrução rápida que reaproveita o cenário decorativo; ao soltar, o mundo completo é refeito). Clicar num trecho da pista seleciona a rampa/ponte/precipício/piso daquele lugar.
- **Pontos da pista**: arraste para mover, ＋ insere no trecho clicado, － remove (mín. 4). Aviso se a curva for fechada demais.
- **Rampas/colinas, precipícios, pontes e materiais do piso** (asfalto, madeira, terra, paralelepípedo): listas com início/fim (sliders, destacados na pista), altura, subida, descida (0 = lábio), grades, lado e largura.
- **Objetos à mão** (`def.objects`: árvore, pedra, casa) e **grupos de caixas de item** (`def.boxGroups`), além da quantidade de cenário aleatório.
- Abra uma pista específica com **`/editor/?track=mountain`**.
- **Salvar** grava em `localStorage` (`rw-debug-track:<id>`, a mesma chave do F4); **Testar no jogo** abre o jogo com `?debug`, que usa a pista salva. Exportar/Importar JSON.
