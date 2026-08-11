import type { PGlite } from '@electric-sql/pglite';
import { getDb } from '../db';
import {
  dismissEstimateDeviation,
  getEstimateDeviation,
  getHoje,
  getMarcos,
  getWorstPoint,
  pendingDays,
  todayBelem,
  updateEstimate,
  type EstimateDeviation,
  type Milestone,
  type WorstPoint,
} from '../db/queries.mjs';
import { renderAcertarSaldo } from './acertar-saldo';
import { renderConfiguracoes } from './configuracoes';
import { debounce } from './debounce';
import {
  formatAmount,
  formatCents,
  formatDateHeaderShort,
  formatDateSlash,
  formatDayRange,
  formatMonthName,
} from './format';
import { renderLancar } from './lancar';
import { renderLinhaDoTempo } from './linha-do-tempo';
import { renderUndoToast, type UndoState } from './undo';

// Tela Hoje (SPEC.md §6): saldo em conta, quanto posso gastar hoje, o
// aviso de dias pendentes, os marcos, o pior momento da janela de 12
// meses e o campo "e se eu gastar ___" que simula os dois ao vivo, sem
// gravar nada.
export function renderHoje(app: HTMLDivElement, undo?: UndoState): void {
  app.innerHTML = '';
  app.className = 'screen screen-hoje';

  const hoje = todayBelem();

  // Wordmark + data: o cabeçalho diz de que dia é o número gigante logo
  // abaixo. Sem ele o "pode gastar hoje" não tem âncora nenhuma na tela.
  const topo = document.createElement('header');
  topo.className = 'hoje-topo';

  const wordmark = document.createElement('span');
  wordmark.className = 'hoje-wordmark';
  wordmark.textContent = 'Termômetro';

  const dataEl = document.createElement('span');
  dataEl.className = 'hoje-data';
  dataEl.textContent = formatDateHeaderShort(hoje);

  topo.append(wordmark, dataEl);

  // O número da tela. "R$" é elemento à parte, menor e apagado, para o
  // olho cair direto nos dígitos — daí formatAmount em vez de formatCents.
  const hero = document.createElement('div');
  hero.className = 'hoje-hero';

  const heroLabel = document.createElement('p');
  heroLabel.className = 'hoje-hero-label';
  heroLabel.textContent = 'Você pode gastar hoje';

  const heroValor = document.createElement('div');
  heroValor.className = 'hoje-hero-valor';

  const heroMoeda = document.createElement('span');
  heroMoeda.className = 'hoje-hero-moeda';
  heroMoeda.textContent = 'R$';

  const heroNumero = document.createElement('span');
  heroNumero.className = 'hoje-hero-numero';
  heroNumero.textContent = '—';

  heroValor.append(heroMoeda, heroNumero);
  hero.append(heroLabel, heroValor);

  const saldoLinha = document.createElement('div');
  saldoLinha.className = 'saldo-linha';

  const saldoLabel = document.createElement('span');
  saldoLabel.className = 'saldo-label';
  saldoLabel.textContent = 'Saldo em conta';

  const saldoValor = document.createElement('span');
  saldoValor.className = 'saldo-valor';

  saldoLinha.append(saldoLabel, saldoValor);

  const estimativaEl = document.createElement('div');
  estimativaEl.className = 'estimativa-aviso';

  const lancarBtn = document.createElement('button');
  lancarBtn.type = 'button';
  lancarBtn.className = 'btn-lancar';
  lancarBtn.textContent = 'Lançar';
  lancarBtn.addEventListener('click', () => renderLancar(app));

  const marcosEl = document.createElement('section');
  marcosEl.className = 'marcos';

  const piorEl = document.createElement('section');
  piorEl.className = 'pior-momento';

  const simularEl = buildSimularField();

  const pendentesEl = document.createElement('div');
  pendentesEl.className = 'pendentes';

  // "Acesso secundário" (SPEC.md §6): a linha do tempo completa, fora da
  // tela principal — mesmo tratamento discreto do botão de Configurações,
  // para não competir com saldo/marcos/simulação.
  const linhaTempoBtn = document.createElement('button');
  linhaTempoBtn.type = 'button';
  linhaTempoBtn.className = 'btn-config';
  linhaTempoBtn.textContent = 'Ver linha do tempo completa';
  linhaTempoBtn.addEventListener('click', () => renderLinhaDoTempo(app));

  // Discreet on purpose: the tela is built around the number at the top, and
  // backup is something the user does occasionally, not daily. Fica depois
  // do aviso de pendentes, que é o que pede ação hoje.
  const configBtn = document.createElement('button');
  configBtn.type = 'button';
  configBtn.className = 'btn-config';
  configBtn.textContent = 'Configurações';
  configBtn.addEventListener('click', () => renderConfiguracoes(app));

  const secundario = document.createElement('div');
  secundario.className = 'hoje-secundario';
  secundario.append(linhaTempoBtn, configBtn);

  app.append(
    topo,
    hero,
    saldoLinha,
    marcosEl,
    piorEl,
    simularEl.container,
    estimativaEl,
    pendentesEl,
    secundario,
    lancarBtn,
  );

  if (undo) {
    renderUndoToast(app, undo, () => renderHoje(app));
  }

  void loadHoje(app, hoje, {
    heroValor,
    heroNumero,
    saldoValor,
    estimativaEl,
    pendentesEl,
    marcosEl,
    piorEl,
    simularEl,
  });
}

interface SimularField {
  container: HTMLDivElement;
  input: HTMLInputElement;
  setCents(cents: bigint | null): void;
  onChange(handler: (whatIfCents: bigint | null) => void): void;
}

// Entrada de dígitos "cents-first" como em createAmountField (numpad.ts),
// mas com teclado nativo em vez do numpad próprio: o campo é para
// digitação ao vivo com debounce, não para o fluxo de confirmação de
// Lançar. Cada tecla dispara um recálculo debounced de marcos/pior
// momento (SPEC.md §6).
const SIMULAR_MAX_DIGITS = 8; // same cap as createAmountField (numpad.ts) — up to R$ 999.999,99

// Atalhos para os valores que se simula de verdade — uma conta grande, uma
// compra média, uma parcela — em vez de obrigar a digitar tudo. Em centavos,
// como todo o resto do app (SPEC.md §5).
const CHIPS_CENTS = [20000n, 50000n, 120000n];

function buildSimularField(): SimularField {
  const container = document.createElement('div');
  container.className = 'simular';

  const linha = document.createElement('div');
  linha.className = 'simular-linha';

  const label = document.createElement('label');
  label.className = 'simular-label';
  label.textContent = 'e se eu gastar';
  label.htmlFor = 'simular-input';

  const campo = document.createElement('div');
  campo.className = 'simular-campo';

  const moeda = document.createElement('span');
  moeda.className = 'simular-moeda';
  moeda.textContent = 'R$';

  const input = document.createElement('input');
  input.id = 'simular-input';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'simular-input';
  input.placeholder = '0,00';
  // Off until loadHoje has marcos/pior momento in hand — typing before that
  // would drop keystrokes silently (the listener isn't wired up yet) and
  // still show raw digits in the box, since formatting lives in the same
  // listener.
  input.disabled = true;

  campo.append(moeda, input);
  linha.append(label, campo);

  const chipsEl = document.createElement('div');
  chipsEl.className = 'simular-chips';

  container.append(linha, chipsEl);

  let digits = '';
  const chips: { botao: HTMLButtonElement; cents: bigint | null }[] = [];

  // A borda do card acende junto com o valor: é o único aviso de que os
  // marcos abaixo já não são o saldo real, e sim uma hipótese.
  const render = (): void => {
    input.value = digits === '' ? '' : formatAmount(BigInt(digits));
    container.classList.toggle('simular-ativo', digits !== '');
    for (const chip of chips) {
      // "limpar" nunca acende: em repouso não há simulação nenhuma para
      // destacar, e um chip aceso diria o contrário.
      const ativo = chip.cents !== null && digits === chip.cents.toString();
      chip.botao.classList.toggle('chip-ativo', ativo);
      chip.botao.setAttribute('aria-pressed', String(ativo));
    }
  };

  const field: SimularField = {
    container,
    input,
    setCents(cents) {
      digits = cents === null || cents <= 0n ? '' : cents.toString().slice(0, SIMULAR_MAX_DIGITS);
      render();
    },
    onChange(handler) {
      const emitir = (): void => handler(digits === '' ? null : BigInt(digits));

      input.addEventListener('input', () => {
        digits = input.value.replace(/\D/g, '').slice(0, SIMULAR_MAX_DIGITS);
        render();
        emitir();
      });

      // Os chips passam pelo mesmo handler debounced da digitação: um toque
      // no chip é a mesma simulação, só sem digitar.
      for (const chip of chips) {
        chip.botao.addEventListener('click', () => {
          // Tocar de novo no chip já ativo desliga a simulação — sem isso o
          // único jeito de voltar ao saldo real seria o "limpar".
          const jaAtivo = chip.cents !== null && digits === chip.cents.toString();
          field.setCents(jaAtivo ? null : chip.cents);
          emitir();
        });
      }
    },
  };

  for (const cents of [...CHIPS_CENTS, null]) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'simular-chip';
    // "200", não "R$ 200,00": são atalhos, e os centavos redondos só
    // roubariam largura de um botão que ocupa um quarto da linha.
    botao.textContent = cents === null ? 'limpar' : formatAmount(cents).replace(',00', '');
    chipsEl.append(botao);
    chips.push({ botao, cents });
  }

  render();
  return field;
}

interface HojeElements {
  heroValor: HTMLElement;
  heroNumero: HTMLElement;
  saldoValor: HTMLElement;
  estimativaEl: HTMLElement;
  pendentesEl: HTMLElement;
  marcosEl: HTMLElement;
  piorEl: HTMLElement;
  simularEl: SimularField;
}

async function loadHoje(app: HTMLDivElement, today: string, els: HojeElements): Promise<void> {
  try {
    const db = await getDb();
    const { saldoCents, podeGastarCents } = await getHoje(db, today);
    const pendentes = await pendingDays(db, today);

    if (podeGastarCents === null) {
      // Sem estimativa não há número para o hero — o "R$" sozinho ao lado de
      // uma frase leria como "R$ sem estimativa".
      els.heroValor.classList.add('hoje-hero-sem-valor');
      els.heroNumero.textContent = 'Sem estimativa diária ainda';
    } else {
      els.heroValor.classList.remove('hoje-hero-sem-valor');
      els.heroNumero.textContent = formatAmount(podeGastarCents);
      els.heroNumero.classList.toggle('valor-negativo', podeGastarCents < 0n);
    }

    els.saldoValor.textContent = `R$ ${formatAmount(saldoCents)}`;
    els.saldoValor.classList.toggle('valor-negativo', saldoCents < 0n);

    if (pendentes.length > 0) {
      renderPendentes(app, els.pendentesEl, pendentes);
    }

    await loadEstimateDeviation(app, db, today, els.estimativaEl);
    await loadMarcos(db, today, els.marcosEl, els.piorEl, els.simularEl);
  } catch (err) {
    els.heroValor.classList.add('hoje-hero-sem-valor');
    els.heroNumero.textContent = `Falha ao carregar o saldo: ${(err as Error).message}`;
    els.saldoValor.textContent = '';
    throw err;
  }
}

// Own try/catch, separate from saldo/quanto-posso-gastar above: a failure
// here must not overwrite an already-successful saldo with a misleading
// "falha ao carregar o saldo" (same reasoning as loadMarcos below).
async function loadEstimateDeviation(
  app: HTMLDivElement,
  db: PGlite,
  today: string,
  estimativaEl: HTMLElement,
): Promise<void> {
  try {
    const desvio = await getEstimateDeviation(db, today);
    if (desvio) {
      renderEstimativaAviso(app, estimativaEl, desvio, today);
    }
  } catch (err) {
    estimativaEl.textContent = `Falha ao carregar o aviso de estimativa: ${(err as Error).message}`;
  }
}

// Aviso de desvio da estimativa (issue #8, SPEC.md §9): "Atualizar" adota o
// gasto real do mês fechado como nova estimativa a partir de hoje, sem
// retroagir; "Manter" só dispensa o mês. Os dois recarregam a tela — o
// card não deve reaparecer depois de qualquer uma das duas escolhas.
function renderEstimativaAviso(
  app: HTMLDivElement,
  container: HTMLElement,
  desvio: EstimateDeviation,
  today: string,
): void {
  container.innerHTML = '';

  const texto = document.createElement('p');
  texto.textContent =
    `Em ${formatMonthName(desvio.month)} você gastou ${formatCents(desvio.actual_cents)}/dia, ` +
    `sua estimativa é ${formatCents(desvio.estimate_cents)}. Atualizar?`;

  const atualizarBtn = document.createElement('button');
  atualizarBtn.type = 'button';
  atualizarBtn.className = 'btn-confirmar';
  atualizarBtn.textContent = 'Atualizar';
  atualizarBtn.addEventListener('click', () => {
    void (async () => {
      atualizarBtn.disabled = true;
      manterBtn.disabled = true;
      const db = await getDb();
      // A nova estimativa vale a partir de hoje, então não muda a comparação
      // do mês fechado (que olha a estimativa vigente naquele mês) — sem
      // dispensar aqui, o card reapareceria idêntico na próxima abertura.
      await updateEstimate(db, desvio.actual_cents, today);
      await dismissEstimateDeviation(db, desvio.month);
      renderHoje(app);
    })();
  });

  const manterBtn = document.createElement('button');
  manterBtn.type = 'button';
  manterBtn.className = 'btn-cancelar';
  manterBtn.textContent = 'Manter';
  manterBtn.addEventListener('click', () => {
    void (async () => {
      atualizarBtn.disabled = true;
      manterBtn.disabled = true;
      const db = await getDb();
      await dismissEstimateDeviation(db, desvio.month);
      renderHoje(app);
    })();
  });

  const acoes = document.createElement('div');
  acoes.className = 'config-acoes';
  acoes.append(manterBtn, atualizarBtn);

  container.append(texto, acoes);
}

// Own try/catch, separate from saldo/quanto-posso-gastar above: a failure
// here must not overwrite an already-successful saldo with a misleading
// "falha ao carregar o saldo".
async function loadMarcos(
  db: PGlite,
  today: string,
  marcosEl: HTMLElement,
  piorEl: HTMLElement,
  simularEl: SimularField,
): Promise<void> {
  try {
    const [marcos, pior] = await Promise.all([getMarcos(db, today), getWorstPoint(db, today)]);
    renderMarcos(marcosEl, marcos, marcos, false);
    renderPiorMomento(piorEl, pior, pior, false);

    // Guards against a stale response overwriting a fresher one when two
    // debounced calls overlap (the DB round trip time isn't guaranteed to
    // stay below the 150ms debounce gap).
    let requestId = 0;

    const simular = debounce(async (whatIfCents: bigint | null) => {
      const thisRequest = ++requestId;

      if (whatIfCents === null) {
        renderMarcos(marcosEl, marcos, marcos, false);
        renderPiorMomento(piorEl, pior, pior, false);
        return;
      }

      const whatIf = [{ date: today, kind: 'saida' as const, amount_cents: Number(whatIfCents) }];
      const [simMarcos, simPior] = await Promise.all([
        getMarcos(db, today, whatIf),
        getWorstPoint(db, today, whatIf),
      ]);

      if (thisRequest !== requestId) return;
      renderMarcos(marcosEl, simMarcos, marcos, true);
      renderPiorMomento(piorEl, simPior, pior, true);
    }, 150);

    simularEl.input.disabled = false;
    simularEl.onChange(simular);
  } catch (err) {
    marcosEl.textContent = `Falha ao carregar marcos: ${(err as Error).message}`;
    piorEl.textContent = '';
  }
}

// A função SQL `milestones()` rotula o primeiro marco de "fim do mês"; a
// tela diz "fim deste mês", que desambigua dos outros três (que também são
// fins de mês, mais adiante). Mapeado aqui e não na query: é texto de tela.
const MARCO_LABELS: Record<string, string> = {
  'fim do mês': 'fim deste mês',
};

// Marcos: fim do mês, +3, +6, +12 meses, cada um com o saldo projetado e,
// enquanto o campo "e se eu gastar ___" tem valor, o delta contra o saldo
// sem simulação (SPEC.md §6). Quatro colunas de largura igual — lado a
// lado é o que deixa a curva do ano visível de relance.
function renderMarcos(
  container: HTMLElement,
  marcos: Milestone[],
  baseline: Milestone[],
  simulating: boolean,
): void {
  container.innerHTML = '';

  for (const marco of marcos) {
    const item = document.createElement('div');
    item.className = 'marco';

    const label = document.createElement('div');
    label.className = 'marco-label';
    label.textContent = MARCO_LABELS[marco.label] ?? marco.label;

    const valor = document.createElement('div');
    valor.className = 'marco-valor';
    valor.textContent = formatAmount(marco.balance_cents);
    valor.classList.toggle('valor-negativo', marco.balance_cents < 0n);

    // Sempre presente, mesmo vazio: sem a linha reservada as quatro colunas
    // pulariam de altura ao começar a simular.
    const delta = document.createElement('div');
    delta.className = 'marco-delta';
    if (simulating) {
      const base = baseline.find((b) => b.label === marco.label);
      const diff = base ? marco.balance_cents - base.balance_cents : 0n;
      delta.textContent = `${diff > 0n ? '+' : ''}${formatAmount(diff)}`;
    }

    const data = document.createElement('div');
    data.className = 'marco-data';
    data.textContent = formatDateSlash(marco.day);

    item.append(label, valor, delta, data);
    container.append(item);
  }
}

// Pior momento: menor saldo da janela de 12 meses e o dia em que ocorre.
// Simulando, mostra entre parênteses o valor de antes — o que interessa
// aqui é "quanto isso piora o fundo do poço", não o delta isolado.
function renderPiorMomento(
  container: HTMLElement,
  pior: WorstPoint,
  baseline: WorstPoint,
  simulating: boolean,
): void {
  container.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'pior-label';
  label.textContent = 'menor saldo:';

  const valor = document.createElement('span');
  valor.className = 'pior-valor';
  // Sem "R$" aqui: a linha é uma frase corrida ("menor saldo: X em 11/nov"),
  // não uma coluna de valores como o hero e o saldo em conta.
  valor.textContent = formatAmount(pior.balance_cents);
  valor.classList.toggle('valor-negativo', pior.balance_cents < 0n);

  const data = document.createElement('span');
  data.className = 'pior-data';
  data.textContent = `em ${formatDateSlash(pior.day)}`;

  container.append(label, valor, data);

  if (simulating) {
    const era = document.createElement('span');
    era.className = 'pior-era';
    era.textContent = `(era ${formatAmount(baseline.balance_cents)})`;
    container.append(era);
  }
}

// "Aviso de dias pendentes: discreto, tocável, leva ao modo de
// recuperação. Sem contador de ofensiva, sem vermelho de cobrança — se o
// app fizer o usuário se sentir devedor, ele para de abrir" (SPEC.md §6).
// Os dois caminhos de §8 ficam lado a lado: preencher em sequência é o
// aviso; acertar saldo é o outro, aqui e não escondido em configurações.
function renderPendentes(app: HTMLDivElement, container: HTMLElement, days: string[]): void {
  const aviso = document.createElement('button');
  aviso.type = 'button';
  aviso.className = 'pendentes-aviso';
  aviso.addEventListener('click', () => renderLancar(app, { recovery: { days, index: 0 } }));

  const texto = document.createElement('span');
  texto.className = 'pendentes-texto';
  texto.textContent = days.length === 1 ? '1 dia sem lançar' : `${days.length} dias sem lançar`;

  // O intervalo diz de que dias se trata sem precisar entrar na fila.
  const intervalo = document.createElement('span');
  intervalo.className = 'pendentes-intervalo';
  const primeiro = days[0] as string;
  const ultimo = days[days.length - 1] as string;
  intervalo.textContent = `${formatDayRange(primeiro, ultimo)} →`;

  aviso.append(texto, intervalo);

  const acertar = document.createElement('button');
  acertar.type = 'button';
  acertar.className = 'pendentes-acertar';
  acertar.textContent = 'Acertar saldo';
  acertar.addEventListener('click', () => renderAcertarSaldo(app));

  container.append(aviso, acertar);
}
