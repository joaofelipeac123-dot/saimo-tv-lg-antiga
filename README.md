# Saimo TV para LG antiga (webOS 3/4)

Patches que fazem o [Saimo TV](https://github.com/SaimoTV/Saimo-Site) funcionar, e rápido, em TVs LG
de 2016–2019 (webOS 3.x/4.x, navegador Chromium 38). Testado numa LG UJ6525 com webOS 3.9.

*English summary: patches that make the Saimo TV webOS app run, and run fast, on 2016–2019 LG TVs
(webOS 3/4, Chromium 38). A daily CI job rebases them onto the latest upstream release, builds the
`.ipk` and tests it in a Chromium with the missing APIs removed.*

## Por que existe

A versão oficial é feita para TVs novas. Na LG antiga ela travava, abria em 40 s e engasgava
ao rolar. Cada problema foi medido na TV real (Chrome DevTools Protocol, Timeline) e corrigido:

| Medida na TV | Antes | Depois |
|---|---|---|
| Abrir o app | 40 s | 3,8 s |
| Pintura da tela em 4 s de rolagem vertical | 10,7 s | 0,65 s |
| Maior travada segurando a tecla | 224 ms | 81 ms |

## Os patches

| Patch | O que faz |
|---|---|
| `0001-tv-antiga` | Fallback de `gap` em flexbox, listas padrão de canais e filmes |
| `0002-atualizacao-pela-tv` | Avisa de versão nova e instala pelo Homebrew Channel (com SHA-256) |
| `0003-desempenho-tv-antiga` | Trilhos de capas em camadas da GPU |
| `0004-capas-sob-demanda` | Capas carregam perto da tela e saem da memória (o Chromium 38 ignora `loading="lazy"`) |
| `0005-polyfills-so-o-que-falta` | Só os polyfills do que falta; o core-js completo trocava `JSON.parse`, `sort` etc. por versões até 145× mais lentas |
| `0006-inicializacao-root` | Religa a inicialização do Homebrew Channel depois do "Quick Start" da TV |
| `0007-rolagem-vertical` | Rolagem vertical na GPU e escala de imagem mais barata |
| `0008-polyfills-primeiro` | Carrega os polyfills antes do React (que guarda `Object.assign` ao carregar) |

O build também gera valores reservas para `var(--x, reserva)` no CSS, porque o Chromium 38 não
conhece variáveis CSS e descartaria a regra inteira.

## Como funciona

[`scripts/montar.sh`](scripts/montar.sh) baixa a versão oficial, aplica os patches na versão em que
foram feitos ([`patches/BASE`](patches/BASE)), leva-os para a versão mais recente com `git rebase`,
compila e roda [`teste/teste-tv-antiga.mjs`](teste/teste-tv-antiga.mjs). O teste abre o app num
Chromium sem as APIs que não existem no Chromium 38 e confere que tudo carrega.

A [rotina diária](.github/workflows/testar.yml) faz isso com a versão oficial do dia, para descobrir
cedo quando uma atualização quebra a TV antiga. O `.ipk` gerado fica nos artefatos da execução.

## Montar você mesmo

```sh
npm install
npx playwright install chromium
mkdir -p publico
URL_PUBLICA=https://seu-site.exemplo FORCAR=1 bash scripts/montar.sh
```

`URL_PUBLICA` é o endereço onde você vai publicar `versao.json` e o `.ipk`, para o aviso de
atualização da TV. Instalar exige uma TV com root e o [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).

## Licença

MIT, como o Saimo TV. Este repositório não contém nem distribui conteúdo de vídeo.
