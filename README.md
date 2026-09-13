# Quebra-cabeça a dois

Página estática para montar um quebra-cabeça online com outra pessoa, em tempo real.
Você escolhe uma foto, cria uma sala e manda o link. Os dois navegadores se conectam
direto (WebRTC) e a foto viaja de um para o outro sem passar por servidor.

## Stack

- **Vite + TypeScript**, sem framework. O tabuleiro é um `<canvas>`.
- **Trystero** para a conexão ponto a ponto. Usa relays Nostr públicos só para o
  aperto de mão inicial; depois é WebRTC direto e criptografado de ponta a ponta.
- **GitHub Pages** via GitHub Actions (`.github/workflows/deploy.yml`).

## Rodando localmente

```bash
npm install
npm run dev
```

Abra o endereço mostrado, escolha uma foto e crie a sala. Para testar a segunda
pessoa, abra o link da sala em outra janela (ou outro dispositivo na mesma rede —
aqui a restrição é do servidor de desenvolvimento, não do jogo publicado).

## Publicando no GitHub Pages

1. Crie um repositório no GitHub e envie este projeto para o branch `main`.
2. No repositório, vá em **Settings → Pages** e em **Source** escolha **GitHub Actions**.
3. Cada push em `main` roda o workflow e publica em
   `https://<usuario>.github.io/<repositorio>/`.

## Servidor TURN (conectar em redes diferentes)

WebRTC direto não passa em NAT simétrico — comum em CGNAT de operadora e em rede
corporativa. Quando isso acontece, os dois lados só se encontram através de um
servidor TURN, que retransmite o tráfego (ainda criptografado de ponta a ponta).

Sem configurar nada, o jogo usa o relay público gratuito do Open Relay Project,
que é best-effort e sai do ar sem aviso. Para uma conexão confiável:

1. Crie uma conta gratuita em <https://dashboard.metered.ca/> (50 GB/mês).
2. Pegue o host em **TURN Server → Overview** e as credenciais estáticas em
   **TURN Server → Credentials**.
3. Local: `cp .env.example .env.local` e preencha as três variáveis.
4. Deploy: adicione `VITE_TURN_HOST`, `VITE_TURN_USERNAME` e
   `VITE_TURN_CREDENTIAL` em **Settings → Secrets and variables → Actions**.
   O workflow injeta na build.

Como o site é estático, as credenciais ficam visíveis no bundle publicado. Por
isso use uma conta com cota limitada e troque a credencial se o consumo subir.

### Diagnóstico

Se ninguém aparecer em 15 segundos, o jogo abre uma conexão descartável para
testar quais candidatos ICE esta rede produz e mostra um painel dizendo se o
problema é a rede, o TURN ou a outra pessoa. Quando a partida fecha por
retransmissão, o HUD mostra "Conectados · via relay".

## Como funciona

- `src/puzzle/geometry.ts` gera as bordas com encaixes (curvas de Bézier) a partir
  de uma semente. Os dois lados calculam a mesma geometria.
- `src/puzzle/engine.ts` cuida do estado: grupos de peças, encaixe entre vizinhos e
  fusão de grupos. Quem solta a peça calcula o resultado e envia para o outro lado.
- `src/puzzle/render.ts` pré-renderiza cada peça e desenha o tabuleiro com pan e zoom.
- `src/puzzle/input.ts` unifica mouse, caneta e toque (arrastar, pinça, roda).
- `src/net/room.ts` encapsula as mensagens do Trystero: imagem, snapshot, movimento,
  soltar, pegar e cursor.
- `src/net/turn.ts` monta a lista de servidores TURN e roda o diagnóstico de ICE.
- `src/storage.ts` salva o progresso de quem criou a sala no IndexedDB. Ao reabrir o
  link, o jogo continua de onde parou e reenvia o estado para a outra pessoa.

## Limitações conhecidas

- Redes muito restritivas (alguns Wi-Fi corporativos) podem bloquear WebRTC. Com um
  TURN próprio configurado a conexão passa na maioria dos casos; sem ele, o relay
  público usado como padrão não tem garantia nenhuma.
- Quem criou a sala precisa estar com a página aberta para a outra pessoa entrar.
  O progresso fica salvo no navegador de quem criou.
