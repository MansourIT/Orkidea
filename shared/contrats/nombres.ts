// Nombres et montants en toutes lettres (orthographe traditionnelle : traits d'union sous cent).

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0 à 99. `final` : « quatre-vingts » prend un s seulement en fin de nombre. */
function belowHundred(n: number, final: boolean): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  if (ten === 7 || ten === 9) {
    // 70-79 : soixante-dix… ; 90-99 : quatre-vingt-dix…
    const base = ten === 7 ? 'soixante' : 'quatre-vingt';
    const rest = 10 + unit;
    if (ten === 7 && unit === 1) return 'soixante et onze';
    return `${base}-${belowHundred(rest, false)}`;
  }
  if (ten === 8) return unit === 0 ? (final ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITS[unit]}`;
  if (unit === 0) return TENS[ten];
  if (unit === 1) return `${TENS[ten]} et un`;
  return `${TENS[ten]}-${UNITS[unit]}`;
}

/** 0 à 999. */
function belowThousand(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return belowHundred(rest, final);
  // « cents » au pluriel seulement en fin de nombre (deux cents, mais deux cent mille).
  const head = hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent${rest === 0 && final ? 's' : ''}`;
  return rest ? `${head} ${belowHundred(rest, final)}` : head;
}

/** Entier positif en toutes lettres, jusqu'à 999 999 999 999. */
export function integerInWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 1e12) throw new RangeError(`Nombre hors limites : ${value}`);
  if (value === 0) return 'zéro';
  const billions = Math.floor(value / 1e9);
  const millions = Math.floor((value % 1e9) / 1e6);
  const thousands = Math.floor((value % 1e6) / 1e3);
  const rest = value % 1e3;
  const parts: string[] = [];
  if (billions) parts.push(`${belowThousand(billions, true)} milliard${billions > 1 ? 's' : ''}`);
  if (millions) parts.push(`${belowThousand(millions, true)} million${millions > 1 ? 's' : ''}`);
  // « mille » est invariable et ne prend pas « un » devant.
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${belowThousand(thousands, false)} mille`);
  if (rest) parts.push(belowThousand(rest, true));
  return parts.join(' ');
}

/** Montant en euros en toutes lettres : 650 → « six cent cinquante euros », 1,5 → « un euro et cinquante centimes ». */
export function eurosInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Montant invalide : ${amount}`);
  const cents = Math.round(amount * 100);
  const euros = Math.floor(cents / 100);
  const c = cents % 100;
  // « un million d'euros » : « de » devant euros après million(s) / milliard(s) ronds.
  const words = integerInWords(euros);
  const of = /(million|milliard)s?$/.test(words) ? ' d’euros' : euros > 1 ? ' euros' : ' euro';
  const main = `${words}${of}`;
  if (!c) return main;
  const centimes = `${integerInWords(c)} centime${c > 1 ? 's' : ''}`;
  return euros ? `${main} et ${centimes}` : centimes;
}

/** Montant au format français : 1250.5 → « 1 250,50 » (espace insécable fine). */
export function formatEuros(amount: number): string {
  return amount.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ');
}
