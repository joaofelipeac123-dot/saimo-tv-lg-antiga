// Teste do pacote antes de publicar. Abre o app empacotado (file://, como na TV) num Chromium
// sem as APIs que faltam no Chromium 38 (LG webOS 3) e confere:
//   1. o app inicia sem erro de JavaScript;
//   2. o mesmo vale com o fallback de `gap` ativo;
//   3. com uma versão nova publicada, aparece o aviso e "Instalar agora" chama o Homebrew Channel.
// Uso: node teste/teste-tv-antiga.mjs <pasta do pacote webos>   (CHROME=<executável> opcional)
import { chromium } from 'playwright';

const pasta = process.argv[2];
if (!pasta) { console.error('uso: teste-tv-antiga.mjs <pasta>'); process.exit(2); }

const REMOVER = `(function(){
  function del(o,k){ try{ Object.defineProperty(o,k,{value:undefined,configurable:true,writable:true}); delete o[k]; }catch(e){} }
  ['find','findIndex','fill','includes','flat','flatMap','at','findLast','findLastIndex','copyWithin'].forEach(function(k){del(Array.prototype,k)});
  ['padStart','padEnd','includes','startsWith','endsWith','repeat','trimStart','trimEnd','replaceAll','at'].forEach(function(k){del(String.prototype,k)});
  ['assign','values','entries','fromEntries','getOwnPropertyDescriptors'].forEach(function(k){del(Object,k)});
  ['from','of'].forEach(function(k){del(Array,k)});
  del(Promise.prototype,'finally'); ['allSettled','any'].forEach(function(k){del(Promise,k)});
  del(NodeList.prototype,'forEach');
  // loading="lazy" (Chromium 77+): sem isso o app usa as capas sob demanda próprias.
  del(HTMLImageElement.prototype,'loading');
  // DOM do Chromium 54+ (append/prepend/before/after/replaceWith): ausente no webOS 3.
  [Element.prototype, Document.prototype, DocumentFragment.prototype, CharacterData.prototype, DocumentType.prototype].forEach(function(p){
    ['append','prepend','before','after','replaceWith','replaceChildren'].forEach(function(k){del(p,k)});
  });
  ['fetch','AbortController','AbortSignal','URLSearchParams','queueMicrotask','structuredClone','IntersectionObserver','ResizeObserver','requestIdleCallback'].forEach(function(k){del(window,k)});
})();`;

// Força a detecção de "TV sem gap" e zera o gap nativo, como numa TV antiga.
const SEM_GAP = `(function(){
  var d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight');
  Object.defineProperty(Element.prototype,'scrollHeight',{configurable:true,get:function(){return this.style&&this.style.rowGap==='1px'?0:d.get.call(this)}});
  document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='*{gap:0!important}';document.head.appendChild(s)});
})();`;

// Simula a LG: webOS no userAgent e a ponte de serviços do sistema (PalmServiceBridge).
const TV_LG = `(function(){
  Object.defineProperty(navigator,'userAgent',{get:function(){return 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/38.0.2125.122 Safari/537.36'}});
  window.__chamadas=[];
  window.PalmServiceBridge=function(){ var self=this;
    this.call=function(uri,params){ window.__chamadas.push({uri:uri,params:JSON.parse(params)});
      var passos=[{statusText:'Downloading…',progress:40},{statusText:'Verifying…'},{statusText:'Installing…'},{statusText:'Finished',finished:true}];
      passos.forEach(function(p,i){ setTimeout(function(){ self.onservicecallback(JSON.stringify(p)); }, 200*(i+1)); });
    };
  };
})();`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  headless: true,
  args: ['--disable-web-security', '--allow-file-access-from-files'],
});

async function abrir({ semGap = false, tv = false, versaoNova = null, boasVindas = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  // TV já usada: pula a tela de boas-vindas (entrar/criar conta), que só aparece na 1ª abertura.
  if (!boasVindas) await page.addInitScript(() => { try { localStorage.setItem('saimo-boas-vindas-feito', '1'); } catch (e) {} });
  if (tv) await page.addInitScript(TV_LG);
  await page.addInitScript(REMOVER);
  if (semGap) await page.addInitScript(SEM_GAP);
  if (versaoNova) {
    await page.route(/\/versao\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(versaoNova) }));
  }
  await page.goto('file://' + pasta + '/index.html');
  await page.waitForTimeout(3000);
  return { page, erros };
}

let falhou = false;
const conferir = (ok, msg) => { console.log((ok ? 'OK  ' : 'XX  ') + msg); if (!ok) falhou = true; };

// 1 e 2: inicia sem erros, com e sem gap.
for (const semGap of [false, true]) {
  // Com fallback de gap, simula a 1ª abertura (tela de boas-vindas da Conta Saimo).
  const { page, erros } = await abrir({ semGap, boasVindas: semGap });
  const r = await page.evaluate(() => ({
    iniciado: !!window.__saimoTVIniciado,
    telaErro: document.body.innerText.indexOf('Erro ao inicializar') >= 0,
    focaveis: document.querySelectorAll('.nav-focusable').length,
    semGap: document.documentElement.classList.contains('sem-gap'),
    capasComSrc: document.querySelectorAll('img[data-sob-demanda][src]').length,
    capasAdiadas: document.querySelectorAll('img[data-sob-demanda]:not([src])').length,
    boasVindas: document.body.innerText.indexOf('Entrar ou criar conta') >= 0,
  }));
  const rotulo = semGap ? '(fallback de gap)' : '';
  conferir(r.iniciado && !r.telaErro && r.focaveis > 5, `app inicia ${rotulo} — ${r.focaveis} itens navegáveis`);
  conferir(erros.length === 0, `sem erros de JavaScript ${rotulo}${erros.length ? ': ' + erros.join(' | ') : ''}`);
  if (semGap) conferir(r.semGap, 'detecção de "sem gap" ativa');
  if (semGap) conferir(r.boasVindas, 'tela de boas-vindas (1ª abertura) aparece');
  if (!semGap) conferir(r.capasAdiadas > 0 && r.capasComSrc > 0 && r.capasComSrc < r.capasAdiadas, `capas sob demanda: ${r.capasComSrc} carregadas, ${r.capasAdiadas} adiadas`);
  await page.close();
}

// 3: aviso de atualização e instalação via Homebrew Channel.
{
  const nova = { versao: '99.0.0', exibir: '99.0.0', ipkUrl: 'https://exemplo.invalid/SaimoTV-LG-99.0.0.ipk', sha256: 'abc123', notas: 'teste' };
  const { page, erros } = await abrir({ tv: true, versaoNova: nova });
  await page.waitForTimeout(7000); // o app verifica 8 s depois de abrir
  const aviso = await page.evaluate(() => document.body.innerText.indexOf('Atualização disponível') >= 0);
  conferir(aviso, 'aviso "Atualização disponível" aparece');
  if (aviso) {
    await page.keyboard.press('Enter'); // foco começa em "Instalar agora"
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ chamadas: window.__chamadas, texto: document.body.innerText }));
    const c = r.chamadas.find((x) => x.uri.indexOf('/install') > 0) || {};
    const v = r.chamadas.find((x) => x.uri.indexOf('/exec') > 0);
    const vigia = v ? Buffer.from(v.params.command.split(' ')[1], 'base64').toString() : '';
    conferir(r.chamadas.some((x) => x.uri === 'luna://org.webosbrew.hbchannel.service/autostart'), 'pede a inicialização do root ao Homebrew Channel');
    conferir(vigia.indexOf('applicationManager/launch') > 0, 'arma a reabertura automática do app');
    conferir(c.uri === 'luna://org.webosbrew.hbchannel.service/install', 'chama o instalador do Homebrew Channel');
    conferir(c.params && c.params.ipkUrl === nova.ipkUrl && c.params.ipkHash === nova.sha256, 'envia link e hash do pacote');
    conferir(r.texto.indexOf('Instalado!') >= 0, 'mostra "Instalado!" no fim');
  }
  conferir(erros.length === 0, 'sem erros de JavaScript (atualização)' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await page.close();
}

await browser.close();
if (falhou) { console.error('Teste falhou: pacote NÃO será publicado.'); process.exit(1); }
console.log('Todos os testes passaram.');
