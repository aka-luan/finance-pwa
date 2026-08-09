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
import { formatCents, formatDateShort, formatMonthName } from './format';
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

  const podeGastarEl = document.createElement('p');
  podeGastarEl.className = 'pode-gastar';
  podeGastarEl.textContent = 'Carregando…';

  const saldoEl = document.createElement('p');
  saldoEl.className = 'saldo';

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

  app.append(
    podeGastarEl,
    saldoEl,
    estimativaEl,
    lancarBtn,
    marcosEl,
    piorEl,
    simularEl.container,
    pendentesEl,
    linhaTempoBtn,
    configBtn,
  );

  if (undo) {
    renderUndoToast(app, undo, () => renderHoje(app));
  }

  void loadHoje(app, podeGastarEl, saldoEl, estimativaEl, pendentesEl, marcosEl, piorEl, simularEl);
}

interface SimularField {
  container: HTMLDivElement;
  input: HTMLInputElement;
  onChange(handler: (whatIfCents: bigint | null) => void): void;
}

// Entrada de dígitos "cents-first" como em createAmountField (numpad.ts),
// mas com teclado nativo em vez do numpad próprio: o campo é para
// digitação ao vivo com debounce, não para o fluxo de confirmação de
// Lançar. Cada tecla dispara um recálculo debounced de marcos/pior
// momento (SPEC.md §6).
const SIMULAR_MAX_DIGITS = 8; // same cap as createAmountField (numpad.ts) — up to R$ 999.999,99

function buildSimularField(): SimularField {
  const container = document.createElement('div');
  container.className = 'simular';

  const label = document.createElement('label');
  label.className = 'simular-label';
  label.textContent = 'E se eu gastar';
  label.htmlFor = 'simular-input';

  const input = document.createElement('input');
  input.id = 'simular-input';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'simular-input';
  input.placeholder = 'R$ 0,00';
  // Off until loadHoje has marcos/pior momento in hand — typing before that
  // would drop keystrokes silently (the listener isn't wired up yet) and
  // still show raw digits in the box, since formatting lives in the same
  // listener.
  input.disabled = true;

  container.append(label, input);

  let digits = '';

  return {
    container,
    input,
    onChange(handler) {
      input.addEventListener('input', () => {
        digits = input.value.replace(/\D/g, '').slice(0, SIMULAR_MAX_DIGITS);
        input.value = digits === '' ? '' : formatCents(BigInt(digits));
        handler(digits === '' ? null : BigInt(digits));
      });
    },
  };
}

async function loadHoje(
  app: HTMLDivElement,
  podeGastarEl: HTMLElement,
  saldoEl: HTMLElement,
  estimativaEl: HTMLElement,
  pendentesEl: HTMLElement,
  marcosEl: HTMLElement,
  piorEl: HTMLElement,
  simularEl: SimularField,
): Promise<void> {
  try {
    const db = await getDb();
    const today = todayBelem();
    const { saldoCents, podeGastarCents } = await getHoje(db, today);
    const pendentes = await pendingDays(db, today);

    podeGastarEl.textContent =
      podeGastarCents === null
        ? 'Sem estimativa diária ainda'
        : `Hoje você pode gastar ${formatCents(podeGastarCents)}`;
    saldoEl.textContent = `Saldo em conta: ${formatCents(saldoCents)}`;

    if (pendentes.length > 0) {
      renderPendentes(app, pendentesEl, pendentes);
    }

    await loadEstimateDeviation(app, db, today, estimativaEl);
    await loadMarcos(db, today, marcosEl, piorEl, simularEl);
  } catch (err) {
    podeGastarEl.textContent = `Falha ao carregar o saldo: ${(err as Error).message}`;
    saldoEl.textContent = '';
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

// Marcos: fim do mês, +3, +6, +12 meses, cada um com o saldo projetado e,
// enquanto o campo "e se eu gastar ___" tem valor, o delta contra o saldo
// sem simulação (SPEC.md §6).
function renderMarcos(
  container: HTMLElement,
  marcos: Milestone[],
  baseline: Milestone[],
  simulating: boolean,
): void {
  container.innerHTML = '';

  const titulo = document.createElement('p');
  titulo.className = 'marcos-titulo';
  titulo.textContent = 'Marcos';
  container.append(titulo);

  const lista = document.createElement('ul');
  lista.className = 'marcos-lista';

  for (const marco of marcos) {
    const item = document.createElement('li');
    item.className = 'marco-item';

    const topo = document.createElement('div');
    topo.className = 'marco-topo';

    const label = document.createElement('span');
    label.className = 'marco-label';
    label.textContent = marco.label;

    const valor = document.createElement('span');
    valor.className = 'marco-valor';
    valor.textContent = formatCents(marco.balance_cents);

    topo.append(label, valor);

    const sub = document.createElement('div');
    sub.className = 'marco-sub';

    const data = document.createElement('span');
    data.className = 'marco-data';
    data.textContent = formatDateShort(marco.day);
    sub.append(data);

    if (simulating) {
      const base = baseline.find((b) => b.label === marco.label);
      const delta = base ? marco.balance_cents - base.balance_cents : 0n;
      const deltaEl = document.createElement('span');
      deltaEl.className = 'marco-delta';
      deltaEl.textContent = `${delta > 0n ? '+' : ''}${formatCents(delta)}`;
      sub.append(deltaEl);
    }

    item.append(topo, sub);
    lista.append(item);
  }

  container.append(lista);
}

// Pior momento: menor saldo da janela de 12 meses e o dia em que ocorre,
// com o delta contra o saldo sem simulação enquanto o usuário simula
// (SPEC.md §6).
function renderPiorMomento(
  container: HTMLElement,
  pior: WorstPoint,
  baseline: WorstPoint,
  simulating: boolean,
): void {
  container.innerHTML = '';

  const titulo = document.createElement('p');
  titulo.className = 'pior-titulo';
  titulo.textContent = 'Pior momento';

  const valor = document.createElement('p');
  valor.className = 'pior-valor';
  valor.textContent = `${formatCents(pior.balance_cents)} em ${formatDateShort(pior.day, { withYear: true })}`;

  container.append(titulo, valor);

  if (simulating) {
    const delta = pior.balance_cents - baseline.balance_cents;
    const deltaEl = document.createElement('p');
    deltaEl.className = 'pior-delta';
    deltaEl.textContent = `${delta > 0n ? '+' : ''}${formatCents(delta)}`;
    container.append(deltaEl);
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
  aviso.textContent = days.length === 1 ? '1 dia sem lançamento' : `${days.length} dias sem lançamento`;
  aviso.addEventListener('click', () => renderLancar(app, { recovery: { days, index: 0 } }));

  const acertar = document.createElement('button');
  acertar.type = 'button';
  acertar.className = 'pendentes-acertar';
  acertar.textContent = 'Acertar saldo';
  acertar.addEventListener('click', () => renderAcertarSaldo(app));

  container.append(aviso, acertar);
}
