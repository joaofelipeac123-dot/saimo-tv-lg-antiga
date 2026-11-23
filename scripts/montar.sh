#!/bin/bash
#
# Gera o Saimo TV para LG antiga (webOS 3/4 com root) a partir da versão oficial mais recente.
#
# 1. Vê se o repositório oficial (SaimoTV/Saimo-Site) ou os patches mudaram desde a última publicação.
# 2. Aplica os patches de patches/ (correções para TV antiga + aviso de atualização).
# 3. Compila, testa num Chromium sem as APIs que faltam na TV antiga e publica em publico/.
#
# Saída: publico/versao.json + publico/SaimoTV-LG-<versão>.ipk
# Variáveis: URL_PUBLICA (obrigatória), FORCAR=1 (gera mesmo sem mudanças).
#
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
: "${URL_PUBLICA:?defina URL_PUBLICA, ex.: https://exemplo.vercel.app}"
UPSTREAM="https://github.com/SaimoTV/Saimo-Site.git"
ATUAL="$RAIZ/publico/versao.json"

campo() { [ -f "$ATUAL" ] && node -e 'const j=require(process.argv[1]);process.stdout.write(String(j[process.argv[2]]??""))' "$ATUAL" "$1" || true; }
saida() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT" || true; }

UP_SHA="$(git ls-remote "$UPSTREAM" refs/heads/main | cut -f1)"
PATCH_SHA="$(cat patches/*.patch scripts/montar.sh | shasum -a 256 | cut -c1-12)"
echo "==> Oficial: $UP_SHA | patches: $PATCH_SHA"
if [ "${FORCAR:-0}" != "1" ] && [ "$UP_SHA" = "$(campo upstreamSha)" ] && [ "$PATCH_SHA" = "$(campo patchSha)" ]; then
  echo "==> Nada mudou desde a versão $(campo exibir). Fim."
  saida "mudou=0"
  exit 0
fi

TRAB="$(mktemp -d)"
trap 'rm -rf "$TRAB"' EXIT
git clone -q --filter=blob:none "$UPSTREAM" "$TRAB/up"
cd "$TRAB/up"
UP_SHA="$(git rev-parse HEAD)"
NOTAS="$(git log -1 --format=%s)"

# Os patches são aplicados na versão em que foram feitos (patches/BASE) e depois levados
# para a oficial mais recente com rebase: mudanças que não conflitam passam sozinhas.
export GIT_AUTHOR_NAME=saimo-lg GIT_AUTHOR_EMAIL=saimo-lg@local GIT_COMMITTER_NAME=saimo-lg GIT_COMMITTER_EMAIL=saimo-lg@local
BASE="$(cat "$RAIZ/patches/BASE")"
echo "==> Aplicando patches (feitos sobre ${BASE:0:7})"
git checkout -q -b lg "$BASE"
if ! git am -q "$RAIZ"/patches/*.patch; then
  git am --abort || true
  echo "XX Os patches não aplicam nem na versão em que foram feitos (${BASE:0:7}). Arquivo de patch corrompido?"
  exit 1
fi
if [ "$BASE" != "$UP_SHA" ]; then
  echo "==> Levando as correções para a versão oficial atual (${UP_SHA:0:7})"
  if ! git rebase -q "$UP_SHA"; then
    echo "XX Conflito entre as correções e a versão oficial nova, nestes arquivos:"
    git diff --name-only --diff-filter=U | sed 's/^/     /'
    git rebase --abort || true
    echo "XX É preciso ajustar os patches (peça ao Claude, com o link desta execução)."
    exit 1
  fi
fi

# Versão no formato do webOS: 3.0.6 → 3.0.600; recompilação da mesma versão oficial → 3.0.601…
UP_VER="$(node -p "require('./package.json').version")"
IFS=. read -r MA MI PA <<< "$UP_VER"
REV=0
if [ "$UP_VER" = "$(campo versaoOficial)" ]; then REV=$(( $(campo revisao) + 1 )); fi
[ "$REV" -le 99 ] || { echo "XX revisões demais para $UP_VER"; exit 1; }
VERSAO="$MA.$MI.$(( PA * 100 + REV ))"
EXIBIR="$UP_VER"; [ "$REV" -gt 0 ] && EXIBIR="$UP_VER (revisão $REV)"
echo "==> Versão: $VERSAO ($EXIBIR)"
node -e 'const f="package.json",j=require("./"+f);j.version=process.argv[1];require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$VERSAO"

echo "==> Instalando dependências"
npm install --ignore-scripts --no-audit --no-fund --silent
( cd tv-native && npm install --no-audit --no-fund --silent )

echo "==> Compilando"
SAIMO_LG_ATUALIZACAO="$URL_PUBLICA/versao.json" bash scripts/montar_tv.sh
IPK="build/tv/SaimoTV-LG.ipk"

echo "==> Testando (Chromium sem as APIs que faltam na TV antiga)"
node "$RAIZ/teste/teste-tv-antiga.mjs" "$TRAB/up/build/tv/webos"

echo "==> Publicando em publico/"
cd "$RAIZ"
rm -f publico/SaimoTV-LG-*.ipk
NOME="SaimoTV-LG-$VERSAO.ipk"
cp "$TRAB/up/$IPK" "publico/$NOME"
SHA="$(shasum -a 256 "publico/$NOME" | cut -d' ' -f1)"
node -e '
const [versao, exibir, versaoOficial, revisao, upstreamSha, patchSha, ipkUrl, sha256, notas] = process.argv.slice(1);
require("fs").writeFileSync("publico/versao.json", JSON.stringify({
  versao, exibir, versaoOficial, revisao: Number(revisao), upstreamSha, patchSha, ipkUrl, sha256, notas,
  publicadoEm: new Date().toISOString(),
}, null, 2) + "\n");
' "$VERSAO" "$EXIBIR" "$UP_VER" "$REV" "$UP_SHA" "$PATCH_SHA" "$URL_PUBLICA/$NOME" "$SHA" "$NOTAS"
cat publico/versao.json
saida "mudou=1"
saida "versao=$EXIBIR"
