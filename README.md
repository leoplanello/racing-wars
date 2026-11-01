# Racing Wars

Corrida *top-down* para até 15 jogadores. A tela principal roda no navegador (PC ou TV) e **cada celular vira um controle** (escaneie o QR Code). Inspirado no Racing Wars da AirConsole (Big Hut Games): picapes de brinquedo em pistas 3D, câmera atrás do pelotão e eliminação de quem fica para trás da câmera.

## Como rodar

Requer [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm start
```

1. Abra **http://localhost:3000** no navegador do PC/TV e clique para liberar o som.
2. No celular (mesma rede Wi-Fi), escaneie o QR Code da tela, ou abra o endereço mostrado e digite o código da sala.
3. O **primeiro celular conectado é o Master**: ele navega nos menus e inicia a partida.
4. Para testar sozinho, no lobby aperte **B** para adicionar bots e **K** para entrar com o teclado (setas + espaço).

No Windows também dá para dar dois cliques em `Iniciar Racing Wars.bat`.

### Problemas comuns
- **O celular não abre a página**: libere o Node.js no Firewall do Windows (rede *privada*). Se o roteador tem "isolamento de clientes", use o hotspot do celular ou do PC.
- **IP errado no QR**: o PC pode ter adaptadores virtuais (WSL, VirtualBox). Aperte **I** no lobby para alternar entre os IPs encontrados.
- **Tela do celular apaga**: desative o bloqueio automático (em HTTP na rede local o navegador não permite Wake Lock). Se apagar, o carro segue reto e a sala continua.
- Outra porta: `PORT=4000 npm start` (PowerShell: `$env:PORT=4000; npm start`).

## Controles (celular, modo paisagem)
- **Botão de ação** (faixa de cima): toque para usar o poder guardado.
- **Seta ◀ (esquerda) e seta ▶ (direita)** (embaixo): segure para esterçar.
- **As duas setas juntas = ré**, em linha reta.
- O carro acelera sozinho. No teclado do host: ← → esterçam, as duas juntas dão ré, espaço usa o poder.

## Documentação
- [docs/REGRAS.md](docs/REGRAS.md): regras, pontuação, itens.
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): arquitetura, protocolo, pastas.
- [docs/ROADMAP.md](docs/ROADMAP.md): o que existe e o que falta.
- Documentos de design originais: `01_…` a `08_…`.

## Testes
```bash
npm test         # simulação (regras, pista, câmera, pontuação)
npm run smoke    # servidor + host falso + 15 celulares falsos (MAX_PLAYERS)
npm run phones   # enche uma sala aberta com celulares simulados
```

Parâmetros de URL do host: `?debug=1` (FPS/latência), `?q=low` (qualidade baixa), `?safe=t,r,b,l` (margens de área segura em px).
