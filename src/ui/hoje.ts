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
import { renderPlanejamento } from './planejamento';
import { renderPrevisao } from './previsao';
import { push, replace } from './nav';
import { renderUndoToast, type UndoState } from './undo';

// Termômetro: a fatia acionável da mesma previsão que Planejamento
// alimenta e que Previsão mostra por completo. A pergunta da tela é
// "quanto posso gastar hoje?"; abaixo, um resumo curto do forecast
// (saldo atual, marcos, menor saldo) e o "e se eu gastar" que o
// altera ao vivo, sem gravar nada.
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
  heroLabel.textContent = 'Quanto posso gastar hoje?';

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

  const estimativaEl = document.createElement('div');
  estimativaEl.className = 'estimativa-aviso';

  const lancarBtn = document.createElement('button');
  lancarBtn.type = 'button';
  lancarBtn.className = 'btn-lancar';
  lancarBtn.textContent = 'Lançar';
  lancarBtn.addEventListener('click', () => push(renderLancar));

  // Resumo da previsão + simulador: o "e se eu gastar" fica acima das
  // métricas para a relação ser óbvia — o valor digitado é a pergunta,
  // as linhas abaixo são a resposta, no mesmo motor de Previsão.
  const previsaoEl = document.createElement('section');
  previsaoEl.className = 'hoje-previsao';

  const simularEl = buildSimularField();

  const metricasEl = document.createElement('div');
  metricasEl.className = 'hoje-metricas';
  metricasEl.setAttribute('aria-live', 'polite');

  previsaoEl.append(simularEl.container, metricasEl);

  const pendentesEl = document.createElement('div');
  pendentesEl.className = 'pendentes';

  // Termômetro responde o hoje; Previsão responde o que vem depois.
  // Mesmo tratamento discreto do botão de Configurações, para não
  // competir com o número. Sem sublinhado de link: a área de toque é
  // que marca o controle, não a decoração do texto.
  const previsaoBtn = document.createElement('button');
  previsaoBtn.type = 'button';
  previsaoBtn.className = 'btn-config';
  previsaoBtn.textContent = 'Ver previsão completa';
  previsaoBtn.addEventListener('click', () => push(renderPrevisao));

  const planejamentoBtn = document.createElement('button');
  planejamentoBtn.type = 'button';
  planejamentoBtn.className = 'btn-config';
  planejamentoBtn.textContent = 'Planejamento';
  planejamentoBtn.addEventListener('click', () => push(renderPlanejamento));

  // Discreet on purpose: the tela is built around the number at the top, and
  // backup is something the user does occasionally, not daily. Fica depois
  // do aviso de pendentes, que é o que pede ação hoje.
  const configBtn = document.createElement('button');
  configBtn.type = 'button';
  configBtn.className = 'btn-config';
  configBtn.textContent = 'Configurações';
  configBtn.addEventListener('click', () => push(renderConfiguracoes));

  const secundario = document.createElement('div');
  secundario.className = 'hoje-secundario';
  secundario.append(previsaoBtn, planejamentoBtn, configBtn);

  app.append(
    topo,
    hero,
    previsaoEl,
    estimativaEl,
    pendentesEl,
    secundario,
    lancarBtn,
  );

  if (undo) {
    renderUndoToast(app, undo, () => replace(renderHoje));
  }

  void loadHoje(hoje, {
    heroValor,
    heroNumero,
    metricasEl,
    estimativaEl,
    pendentesEl,
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
// Lançar. Cada tecla dispara um recálculo debounced das métricas da
// previsão (marcos + menor saldo + saldo atual). Nada é gravado.
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
  // Off until loadHoje has as métricas da previsão em mão — typing before
  // that would drop keystrokes silently (the listener isn't wired up yet)
  // and still show raw digits in the box, since formatting lives in the
  // same listener.
  input.disabled = true;

  campo.append(moeda, input);
  linha.append(label, campo);

  const chipsEl = document.createElement('div');
  chipsEl.className = 'simular-chips';

  container.append(linha, chipsEl);

  let digits = '';
  const chips: { botao: HTMLButtonElement; cents: bigint | null }[] = [];

  // A borda do card acende junto com o valor: é o único aviso de que as
  // métricas abaixo já não são o saldo real, e sim uma hipótese.
  const render = (): void => {
    input.value = digits === '' ? '' : formatAmount(BigInt(digits));
    container.classList.toggle('simular-ativo', digits !== '');
    container.parentElement?.classList.toggle('hoje-previsao-sim', digits !== '');
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
  metricasEl: HTMLElement;
  estimativaEl: HTMLElement;
  pendentesEl: HTMLElement;
  simularEl: SimularField;
}

async function loadHoje(today: string, els: HojeElements): Promise<void> {
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

    renderForecastMetrics(els.metricasEl, {
      saldoCents,
      marcos: [],
      pior: null,
      baselineSaldo: saldoCents,
      baselineMarcos: [],
      baselinePior: null,
      simulating: false,
    });

    if (pendentes.length > 0) {
      renderPendentes(els.pendentesEl, pendentes);
    }

    await loadEstimateDeviation(db, today, els.estimativaEl);
    await loadMarcos(db, today, saldoCents, els.metricasEl, els.simularEl);
  } catch (err) {
    els.heroValor.classList.add('hoje-hero-sem-valor');
    els.heroNumero.textContent = `Falha ao carregar o saldo: ${(err as Error).message}`;
    throw err;
  }
}

// Own try/catch, separate from saldo/quanto-posso-gastar above: a failure
// here must not overwrite an already-successful saldo with a misleading
// "falha ao carregar o saldo" (same reasoning as loadMarcos below).
async function loadEstimateDeviation(
  db: PGlite,
  today: string,
  estimativaEl: HTMLElement,
): Promise<void> {
  try {
    const desvio = await getEstimateDeviation(db, today);
    if (desvio) {
      renderEstimativaAviso(estimativaEl, desvio, today);
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
      replace(renderHoje);
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
      replace(renderHoje);
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
  saldoCents: bigint,
  metricasEl: HTMLElement,
  simularEl: SimularField,
): Promise<void> {
  try {
    const [marcos, pior] = await Promise.all([getMarcos(db, today), getWorstPoint(db, today)]);
    const baseline = { saldoCents, marcos, pior: pior ?? null };
    paintForecast(metricasEl, baseline, null);

    // Guards against a stale response overwriting a fresher one when two
    // debounced calls overlap (the DB round trip time isn't guaranteed to
    // stay below the 150ms debounce gap).
    let requestId = 0;

    const simular = debounce(async (whatIfCents: bigint | null) => {
      const thisRequest = ++requestId;

      if (whatIfCents === null) {
        paintForecast(metricasEl, baseline, null);
        return;
      }

      const whatIf = [{ date: today, kind: 'saida' as const, amount_cents: Number(whatIfCents) }];
      const [simMarcos, simPior] = await Promise.all([
        getMarcos(db, today, whatIf),
        getWorstPoint(db, today, whatIf),
      ]);

      if (thisRequest !== requestId) return;
      paintForecast(
        metricasEl,
        { saldoCents: saldoCents - whatIfCents, marcos: simMarcos, pior: simPior ?? null },
        baseline,
      );
    }, 150);

    simularEl.input.disabled = false;
    simularEl.onChange(simular);
  } catch (err) {
    paintForecast(metricasEl, { saldoCents, marcos: [], pior: null }, null);
    const erro = document.createElement('p');
    erro.className = 'hoje-metricas-erro';
    erro.textContent = `Falha ao carregar a previsão: ${(err as Error).message}`;
    metricasEl.append(erro);
  }
}

type ForecastSnapshot = {
  saldoCents: bigint;
  marcos: Milestone[];
  pior: WorstPoint | null;
};

function paintForecast(
  container: HTMLElement,
  current: ForecastSnapshot,
  baseline: ForecastSnapshot | null,
): void {
  renderForecastMetrics(container, {
    saldoCents: current.saldoCents,
    marcos: current.marcos,
    pior: current.pior,
    baselineSaldo: baseline?.saldoCents ?? current.saldoCents,
    baselineMarcos: baseline?.marcos ?? current.marcos,
    baselinePior: baseline?.pior ?? current.pior,
    simulating: baseline !== null,
  });
}

// A função SQL `milestones()` rotula o primeiro marco de "fim do mês"; a
// tela diz "fim deste mês", que desambigua dos outros três (que também são
// fins de mês, mais adiante). Mapeado aqui e não na query: é texto de tela.
const MARCO_LABELS: Record<string, string> = {
  'fim do mês': 'fim deste mês',
};

interface ForecastMetrics {
  saldoCents: bigint;
  marcos: Milestone[];
  pior: WorstPoint | null;
  baselineSaldo: bigint;
  baselineMarcos: Milestone[];
  baselinePior: WorstPoint | null;
  simulating: boolean;
}

// Poucas linhas, todas do mesmo motor (balance_on / milestones /
// worst_point → timeline). Não é dashboard: label à esquerda, valor à
// direita, delta em âmbar só enquanto o "e se eu gastar" tem valor.
function renderForecastMetrics(container: HTMLElement, metrics: ForecastMetrics): void {
  container.innerHTML = '';

  appendMetrica(container, {
    label: 'saldo atual',
    amount: metrics.saldoCents,
    baseline: metrics.baselineSaldo,
    simulating: metrics.simulating,
  });

  for (const marco of metrics.marcos) {
    const base = metrics.baselineMarcos.find((b) => b.label === marco.label);
    appendMetrica(container, {
      label: MARCO_LABELS[marco.label] ?? marco.label,
      amount: marco.balance_cents,
      baseline: base?.balance_cents ?? marco.balance_cents,
      simulating: metrics.simulating,
    });
  }

  if (metrics.pior) {
    appendMetrica(container, {
      label: 'menor saldo',
      amount: metrics.pior.balance_cents,
      baseline: metrics.baselinePior?.balance_cents ?? metrics.pior.balance_cents,
      when: metrics.pior.day,
      simulating: metrics.simulating,
    });
  }
}

function appendMetrica(
  container: HTMLElement,
  row: {
    label: string;
    amount: bigint;
    baseline: bigint;
    simulating: boolean;
    when?: string;
  },
): void {
  const item = document.createElement('div');
  item.className = 'hoje-metrica';

  const label = document.createElement('span');
  label.className = 'hoje-metrica-label';
  label.textContent = row.label;

  const leitura = document.createElement('span');
  leitura.className = 'hoje-metrica-leitura';

  if (row.simulating) {
    const diff = row.amount - row.baseline;
    const delta = document.createElement('span');
    delta.className = 'hoje-metrica-delta';
    delta.textContent = `${diff > 0n ? '+' : ''}${formatAmount(diff)}`;
    leitura.append(delta);
  }

  const valor = document.createElement('span');
  valor.className = 'hoje-metrica-valor';
  valor.textContent = formatAmount(row.amount);
  valor.classList.toggle('valor-negativo', row.amount < 0n);
  leitura.append(valor);

  if (row.when) {
    const quando = document.createElement('span');
    quando.className = 'hoje-metrica-quando';
    quando.textContent = `em ${formatDateSlash(row.when)}`;
    leitura.append(quando);
  }

  item.append(label, leitura);
  container.append(item);
}

// "Aviso de dias pendentes: discreto, tocável, leva ao modo de
// recuperação. Sem contador de ofensiva, sem vermelho de cobrança — se o
// app fizer o usuário se sentir devedor, ele para de abrir" (SPEC.md §6).
// Os dois caminhos de §8 ficam lado a lado: preencher em sequência é o
// aviso; acertar saldo é o outro, aqui e não escondido em configurações.
function renderPendentes(container: HTMLElement, days: string[]): void {
  const aviso = document.createElement('button');
  aviso.type = 'button';
  aviso.className = 'pendentes-aviso';
  aviso.addEventListener('click', () => push((el) => renderLancar(el, { recovery: { days, index: 0 } })));

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
  acertar.addEventListener('click', () => push(renderAcertarSaldo));

  container.append(aviso, acertar);
}
