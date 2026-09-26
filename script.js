import { logoMask } from './logo-mask.js';

const DEFAULT_API_BASE = 'https://mempool.space/api';
const STORAGE_KEY = 'btc-journey-addresses';
const SETTINGS_KEY = 'btc-journey-settings';
const THEME_KEY = 'btc-journey-theme';
const LANGUAGE_KEY = 'btc-journey-language';
const BALANCE_CACHE_KEY = 'btc-journey-balances';
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LANGUAGE = 'cs';
const LANGUAGES = {
    cs: {
        labelKey: 'czech',
        flag: 'lang/flags/cz.svg',
        numberLocale: 'cs-CZ',
        fallback: 'en',
    },
    en: {
        labelKey: 'english',
        flag: 'lang/flags/gb.svg',
        numberLocale: 'en-GB',
        fallback: 'cs',
    },
    de: {
        labelKey: 'german',
        flag: 'lang/flags/de.svg',
        numberLocale: 'de-DE',
        fallback: 'en',
    },
    es: {
        labelKey: 'spanish',
        flag: 'lang/flags/es.svg',
        numberLocale: 'es-ES',
        fallback: 'en',
    },
    fr: {
        labelKey: 'french',
        flag: 'lang/flags/fr.svg',
        numberLocale: 'fr-FR',
        fallback: 'en',
    },
    pt: {
        labelKey: 'brazilianPortuguese',
        flag: 'lang/flags/br.svg',
        numberLocale: 'pt-BR',
        fallback: 'en',
    },
    pl: {
        labelKey: 'polish',
        flag: 'lang/flags/pl.svg',
        numberLocale: 'pl-PL',
        fallback: 'en',
    },
    sk: {
        labelKey: 'slovak',
        flag: 'lang/flags/sk.svg',
        numberLocale: 'sk-SK',
        fallback: 'en',
    },
};
const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES);
let language = (() => {
    let savedLanguage;
    try {
        savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    } catch (_) {}
    if (SUPPORTED_LANGUAGES.includes(savedLanguage)) return savedLanguage;
    for (const locale of navigator.languages || [navigator.language]) {
        const code = locale.toLowerCase().split('-')[0];
        if (SUPPORTED_LANGUAGES.includes(code)) return code;
    }
    return DEFAULT_LANGUAGE;
})();
let messages = null;
const SATS_PER_BTC = 100000000;
const MAX_GOAL_BTC = 1000000;
const TILE_COUNT = 10000;
const MAX_ADDRESSES = 5;
const DEFAULT_SETTINGS = {
    goalSats: SATS_PER_BTC,
    apiBase: DEFAULT_API_BASE,
    motivation: '',
    showProgress: true,
    showBalance: true,
    showAddresses: true,
    presentationMode: false,
    animationDirection: 'horizontal',
};
const settings = readSettings();
const numberLocale = () => LANGUAGES[language].numberLocale;
let integer = new Intl.NumberFormat(numberLocale(), {
    maximumFractionDigits: 0,
});
const tiles = [];
const animationTiles = [];
let addresses = readAddresses();
const cachedBalances = readBalanceCache();
let currentSats = null;
let paintedTiles = 0;
let tileAnimationFrame = null;
let displayedSats = null;
let currentMessage = null;
let cacheStatusKey = '';
let languageRequest = 0;
let balanceRequest = 0;

const $ = (id) => document.getElementById(id);
const languageToggle = $('language-toggle');
const languageMenu = $('language-menu');

function t(key, values = {}) {
    const template = messages?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

function renderLanguageOptions() {
    const buttons = Object.entries(LANGUAGES).map(([code, config]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.language = code;
        button.dataset.labelKey = config.labelKey;

        const flag = document.createElement('img');
        flag.className = 'language-flag';
        flag.src = config.flag;
        flag.alt = '';
        button.append(flag);
        return button;
    });

    languageMenu.replaceChildren(...buttons);
}

async function loadLanguage(code) {
    if (!SUPPORTED_LANGUAGES.includes(code)) throw new Error('Unsupported language.');
    const response = await fetch(`lang/${code}.json`, {
        cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`Could not load lang/${code}.json (${response.status}).`);
    const dictionary = await response.json();
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
        throw new Error(`Invalid language file: lang/${code}.json.`);
    }
    return dictionary;
}

function updateLanguageUI() {
    document.documentElement.lang = language;
    document.title = t('title');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = t('description');
    document.querySelector('meta[property="og:title"]').content = t('title');
    document.querySelector('meta[property="og:description"]').content = t('description');
    renderLanguageOptions();
    document.querySelectorAll('[data-i18n]').forEach((node) => {
        node.textContent = t(node.dataset.i18n);
    });
    $('settings-toggle').setAttribute('aria-label', t('settingsOpen'));
    $('settings-toggle').title = t('settingsName');
    $('settings-close').setAttribute('aria-label', t('settingsClose'));
    $('language-toggle').setAttribute('aria-label', t('languageOpen'));
    $('language-toggle').title = t('languageName');
    document.querySelector('.visual').setAttribute('aria-label', t('visualLabel'));
    $('summary').setAttribute('aria-label', t('summaryLabel'));
    $('address-input').setAttribute('aria-label', t('addressInput'));
    $('address-input').placeholder = t('addressPlaceholder');
    document.querySelector('.add-address').setAttribute('aria-label', t('addAddress'));
    document.querySelector('.add-address').title = t('addAddress');
    document.querySelectorAll('[data-language]').forEach((button) => {
        button.setAttribute('aria-current', String(button.dataset.language === language));
        button.setAttribute('aria-label', t(button.dataset.labelKey));
        button.title = t(button.dataset.labelKey);
    });
    $('tile-total').textContent = group(TILE_COUNT);
    $('tile-count').textContent = group(0);
    $('sats').textContent = t('balanceUnknown');
    updateFooterApi();
    setTheme(document.documentElement.dataset.theme);
    updateGoalPreview();
    applySettingsToPage();
    if (displayedSats !== null) renderBalanceValues(displayedSats, paintedTiles);
    renderAddresses();
    showCacheStatus(cacheStatusKey);
    if (currentMessage) showMessage(currentMessage.key, currentMessage.values);
    if (!settingsError.hidden && settingsError.dataset.messageKey) {
        settingsError.textContent = t(settingsError.dataset.messageKey);
    }
    if (!$('api-error').hidden && $('api-error').dataset.messageKey) {
        $('api-error').textContent = t($('api-error').dataset.messageKey);
    }
    const logo = $('bitcoin');
    if (logo)
        logo.setAttribute(
            'aria-label',
            t('logoLabel', {
                goal: goalBtcLabel(),
            }),
        );
}

async function setLanguage(code) {
    if (!SUPPORTED_LANGUAGES.includes(code)) return;
    const request = ++languageRequest;
    const loadedMessages = await loadLanguage(code);
    if (request !== languageRequest) return;
    language = code;
    messages = loadedMessages;
    integer = new Intl.NumberFormat(numberLocale(), {
        maximumFractionDigits: 0,
    });
    try {
        localStorage.setItem(LANGUAGE_KEY, code);
    } catch (_) {
        /* Storage may be unavailable. */
    }
    updateLanguageUI();
}

function readSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        if (!saved || typeof saved !== 'object')
            return {
                ...DEFAULT_SETTINGS,
            };

        const goalSats =
            Number.isSafeInteger(saved.goalSats) &&
            saved.goalSats > 0 &&
            saved.goalSats <= MAX_GOAL_BTC * SATS_PER_BTC
                ? saved.goalSats
                : DEFAULT_SETTINGS.goalSats;
        const savedMotivation =
            typeof saved.motivation === 'string' ? saved.motivation.slice(0, 120) : '';
        let apiBase = DEFAULT_API_BASE;
        try {
            apiBase = normalizeApiBase(saved.apiBase || DEFAULT_API_BASE);
        } catch (_) {}

        return {
            goalSats,
            apiBase,
            motivation: savedMotivation,
            showProgress: saved.showProgress !== false,
            showBalance: saved.showBalance !== false,
            showAddresses: saved.showAddresses !== false,
            presentationMode: saved.presentationMode === true,
            animationDirection: saved.animationDirection === 'vertical' ? 'vertical' : 'horizontal',
        };
    } catch (_) {
        return {
            ...DEFAULT_SETTINGS,
        };
    }
}

function normalizeApiBase(value) {
    let url;
    try {
        url = new URL(value.trim());
    } catch (_) {
        throw new Error('apiInvalid');
    }
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        throw new Error('apiInvalid');
    }
    if (location.protocol === 'https:' && url.protocol !== 'https:') {
        throw new Error('apiHttpsRequired');
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function updateFooterApi() {
    const link = $('api-link');
    const url = new URL(settings.apiBase);
    link.href = settings.apiBase;
    link.textContent = url.host;
}

const themeToggle = $('theme-toggle');
const savedTheme = (() => {
    try {
        return localStorage.getItem(THEME_KEY);
    } catch (_) {
        return null;
    }
})();
const initialTheme =
    savedTheme === 'dark' || savedTheme === 'light'
        ? savedTheme
        : matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
document.documentElement.dataset.theme = initialTheme;

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(
        document.documentElement,
    )
        .getPropertyValue('--paper')
        .trim();
    const dark = theme === 'dark';
    themeToggle.setAttribute('aria-pressed', String(dark));
    themeToggle.setAttribute('aria-label', dark ? t('themeToLight') : t('themeToDark'));
    themeToggle.title = dark ? t('themeToLight') : t('themeToDark');
    themeToggle.innerHTML = dark
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"></path></svg>';
}

themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
        localStorage.setItem(THEME_KEY, nextTheme);
    } catch (_) {
        /* Storage may be unavailable. */
    }
});

function closeLanguageMenu() {
    languageMenu.hidden = true;
    languageToggle.setAttribute('aria-expanded', 'false');
}
languageToggle.addEventListener('click', () => {
    languageMenu.hidden = !languageMenu.hidden;
    languageToggle.setAttribute('aria-expanded', String(!languageMenu.hidden));
});
languageMenu.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-language]');
    if (!button) return;
    closeLanguageMenu();
    if (button.dataset.language !== language) {
        try {
            await setLanguage(button.dataset.language);
        } catch (error) {
            console.error(error);
        }
    }
});
document.addEventListener('click', (event) => {
    if (!event.target.closest('.language-control')) closeLanguageMenu();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeLanguageMenu();
        disablePresentationMode();
    }
});

// Settings and presentation mode
const settingsDialog = $('settings-dialog');
const settingsForm = $('settings-form');
const settingsError = $('settings-error');
const coinStage = $('coin-stage');

function applyPresentationMode(enabled) {
    coinStage.classList.toggle('presentation-active', enabled);
    document.body.classList.toggle('presentation-open', enabled);
}

function disablePresentationMode() {
    if (!settings.presentationMode) return;
    settings.presentationMode = false;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {
        /* Storage may be unavailable. */
    }
    applyPresentationMode(false);
}

coinStage.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'mouse') disablePresentationMode();
});

function goalBtcLabel() {
    return new Intl.NumberFormat(numberLocale(), {
        maximumFractionDigits: 8,
    }).format(settings.goalSats / SATS_PER_BTC);
}

function decimalSeparator() {
    return new Intl.NumberFormat(numberLocale())
        .formatToParts(1.1)
        .find((part) => part.type === 'decimal').value;
}

function goalInputValue(sats) {
    const whole = Math.floor(sats / SATS_PER_BTC);
    const fraction = String(sats % SATS_PER_BTC)
        .padStart(8, '0')
        .replace(/0+$/, '');
    return fraction ? `${whole}${decimalSeparator()}${fraction}` : String(whole);
}

function parseGoal(raw) {
    const match = raw.trim().match(/^(?:(\d{1,7})(?:[.,](\d{0,8}))?|[.,](\d{1,8}))$/);
    if (!match) return null;
    const whole = Number(match[1] || 0);
    const fraction = (match[2] ?? match[3] ?? '').padEnd(8, '0');
    const sats = whole * SATS_PER_BTC + Number(fraction);
    return Number.isSafeInteger(sats) && sats > 0 && sats <= MAX_GOAL_BTC * SATS_PER_BTC
        ? sats
        : null;
}

function applySettingsToPage() {
    $('motivation').textContent = settings.motivation;
    $('motivation').hidden = !settings.motivation;
    $('tile-label').textContent = t('tileLabel', {
        sats: new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 4 }).format(
            settings.goalSats / TILE_COUNT,
        ),
    });
    $('goal-label').textContent = t('goalLabel', {
        goal: goalBtcLabel(),
    });
    $('remaining-label').textContent = t('remaining');
    applySettingsVisibility();
}

function applySettingsVisibility() {
    const hasBalance = currentSats !== null;
    $('progress-section').hidden = !settings.showProgress || !hasBalance;
    $('balance-section').hidden = !settings.showBalance || !hasBalance;
    $('remaining-section').hidden = !settings.showBalance || !hasBalance;
    $('addresses-section').hidden = !settings.showAddresses;
    const everythingHidden =
        !settings.showProgress && !settings.showBalance && !settings.showAddresses;
    const progressVisible = settings.showProgress && hasBalance;
    const balanceVisible = settings.showBalance && hasBalance;
    document.querySelector('.tile-counter').hidden = !settings.showProgress && !everythingHidden;
    $('summary').hidden = everythingHidden;
    $('summary').classList.toggle('summary-no-progress', !progressVisible && balanceVisible);
    $('summary').classList.toggle(
        'summary-addresses-only',
        !progressVisible && !balanceVisible && settings.showAddresses,
    );
    document.querySelector('.layout').classList.toggle('layout-full', everythingHidden);
}

function populateSettingsForm() {
    $('goal-input').value = goalInputValue(settings.goalSats);
    $('api-url-input').value = settings.apiBase;
    $('motivation-input').value = settings.motivation;
    updateGoalPreview();
    $('show-progress-input').checked = settings.showProgress;
    $('show-balance-input').checked = settings.showBalance;
    $('show-addresses-input').checked = settings.showAddresses;
    $('presentation-mode-input').checked = settings.presentationMode;
    $('animation-direction-input').checked = settings.animationDirection === 'vertical';
    settingsError.hidden = true;
    settingsError.textContent = '';
    delete settingsError.dataset.messageKey;
    $('api-error').hidden = true;
    $('api-error').textContent = '';
    delete $('api-error').dataset.messageKey;
    $('api-url-input').setAttribute('aria-invalid', 'false');
}

function showSettingsError(key) {
    settingsError.dataset.messageKey = key;
    settingsError.textContent = t(key);
    settingsError.hidden = false;
}

function showApiError(key) {
    const error = $('api-error');
    error.dataset.messageKey = key;
    error.textContent = t(key);
    error.hidden = false;
    $('api-url-input').setAttribute('aria-invalid', 'true');
}

function updateGoalPreview(showValidation = false) {
    const input = $('goal-input');
    const goalSats = parseGoal(input.value);
    const label =
        goalSats !== null
            ? new Intl.NumberFormat(numberLocale(), {
                  maximumFractionDigits: 8,
              }).format(goalSats / SATS_PER_BTC)
            : goalBtcLabel();
    $('motivation-input').placeholder = t('motivationPlaceholder', {
        goal: label,
    });
    input.setAttribute('aria-invalid', String(showValidation && goalSats === null));
    $('goal-error').hidden = !showValidation || goalSats !== null;
}

$('settings-toggle').addEventListener('click', () => {
    populateSettingsForm();
    settingsDialog.showModal();
});
$('goal-input').addEventListener('input', (event) => {
    const input = event.currentTarget;
    const separatorIndex = input.value.search(/[.,]/);
    if (separatorIndex !== -1) {
        const fraction = input.value.slice(separatorIndex + 1);
        if (fraction.length > 8) {
            const overflow = fraction.length - 8;
            input.value = `${input.value.slice(0, separatorIndex + 1)}${fraction.slice(0, 8)}`;
            const caret = Math.max(separatorIndex + 1, input.selectionStart - overflow);
            input.setSelectionRange(caret, caret);
        }
    }
    updateGoalPreview(true);
});
$('api-url-input').addEventListener('input', () => {
    $('api-error').hidden = true;
    $('api-url-input').setAttribute('aria-invalid', 'false');
});
$('settings-close').addEventListener('click', () => settingsDialog.close());
$('settings-cancel').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) settingsDialog.close();
});
settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const goalInput = $('goal-input');
    const goalSats = parseGoal(goalInput.value);
    const motivation = $('motivation-input').value.trim();

    if (goalSats === null) {
        updateGoalPreview(true);
        goalInput.focus();
        return;
    }
    let apiBase;
    try {
        apiBase = normalizeApiBase($('api-url-input').value);
    } catch (error) {
        showApiError(error.message);
        $('api-url-input').focus();
        return;
    }

    const nextSettings = {
        goalSats,
        apiBase,
        motivation,
        showProgress: $('show-progress-input').checked,
        showBalance: $('show-balance-input').checked,
        showAddresses: $('show-addresses-input').checked,
        presentationMode: $('presentation-mode-input').checked,
        animationDirection: $('animation-direction-input').checked ? 'vertical' : 'horizontal',
    };
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
    } catch (_) {
        showSettingsError('saveSettingsFailed');
        return;
    }
    const apiChanged = apiBase !== settings.apiBase;
    Object.assign(settings, nextSettings);
    settingsDialog.close();
    if (tileAnimationFrame !== null) cancelAnimationFrame(tileAnimationFrame);
    tileAnimationFrame = null;
    if (apiChanged) {
        balanceRequest++;
        cachedBalances.clear();
        saveBalanceCache();
        currentSats = null;
        displayedSats = null;
    }
    buildLogo(currentSats === null ? 0 : tilesFor(currentSats));
    if (currentSats !== null) renderBalanceValues(currentSats);
    applySettingsToPage();
    updateFooterApi();
    updateExportAvailability();
    applyPresentationMode(settings.presentationMode);
    if (apiChanged) loadBalance();
});

// Logo and animated values
function tilesFor(sats) {
    const capped = Math.max(0, Math.min(sats, settings.goalSats));
    return Number((BigInt(capped) * BigInt(TILE_COUNT)) / BigInt(settings.goalSats));
}

function buildLogo(filled = 0) {
    tiles.length = 0;
    animationTiles.length = 0;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.id = 'bitcoin';
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('viewBox', '-4 -4 129 185');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
        'aria-label',
        t('logoLabel', {
            goal: goalBtcLabel(),
        }),
    );
    const group = document.createElementNS(ns, 'g');
    group.id = 'tiles';
    group.setAttribute('stroke-width', '.09');
    group.setAttribute('stroke-linejoin', 'miter');
    let index = 0;
    logoMask.split('\n').forEach((row, y) => {
        row.split(',').forEach((run) => {
            const [start, end] = run.split(':').map(Number);
            for (let x = start; x <= end; x++) {
                const tile = document.createElementNS(ns, 'rect');
                tile.setAttribute('x', `${x}.1`);
                tile.setAttribute('y', `${y}.1`);
                tile.setAttribute('width', '.8');
                tile.setAttribute('height', '.8');
                group.appendChild(tile);
                tiles[index++] = tile;
            }
        });
    });
    if (index !== TILE_COUNT) throw new Error('Logo mask must contain exactly 10,000 tiles.');
    animationTiles.push(...tiles);
    if (settings.animationDirection === 'vertical') {
        animationTiles.sort(
            (first, second) =>
                Number(first.getAttribute('x')) - Number(second.getAttribute('x')) ||
                Number(first.getAttribute('y')) - Number(second.getAttribute('y')),
        );
    }
    animationTiles.forEach((tile, tileIndex) =>
        tile.classList.toggle('filled', tileIndex < filled),
    );
    svg.appendChild(group);
    $('coin-stage').replaceChildren(svg);
    paintedTiles = filled;
}

function setPaintedTiles(count) {
    const start = Math.min(paintedTiles, count);
    const end = Math.max(paintedTiles, count);
    for (let index = start; index < end; index++) {
        animationTiles[index].classList.toggle('filled', index < count);
    }
    paintedTiles = count;
}

function renderBalanceValues(sats, filled = tilesFor(sats)) {
    displayedSats = sats;
    const complete = filled === TILE_COUNT;
    $('tile-count').textContent = group(filled);
    $('percentage').textContent = percentage(filled);
    $('progress-caption').textContent = complete
        ? t('progressComplete', {
              total: group(TILE_COUNT),
          })
        : t('progressCaption', {
              filled: group(filled),
              total: group(TILE_COUNT),
          });
    $('balance').textContent = amount(sats);
    $('balance').parentElement.classList.toggle('compact', sats >= settings.goalSats * 1000);
    $('sats').textContent = t('satsValue', {
        sats: group(sats),
    });
    const remainingSats = Math.max(0, settings.goalSats - sats);
    $('remaining').textContent = amount(remainingSats);
    $('remaining-sats').textContent = t('satsValue', {
        sats: group(remainingSats),
    });
}

function animateBalance(targetSats, targetTiles) {
    if (tileAnimationFrame !== null) cancelAnimationFrame(tileAnimationFrame);
    const distance = Math.abs(targetTiles - paintedTiles);
    const duration = Math.min(5000, Math.max(1800, (distance / TILE_COUNT) * 5000));
    const startedAt = performance.now() + 500;
    setPaintedTiles(0);
    renderBalanceValues(0);
    const step = (now) => {
        const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
        const animatedSats = progress === 1 ? targetSats : Math.round(targetSats * progress);
        const animatedTiles = progress === 1 ? targetTiles : Math.floor(targetTiles * progress);
        setPaintedTiles(animatedTiles);
        renderBalanceValues(animatedSats, animatedTiles);
        if (progress < 1) {
            tileAnimationFrame = requestAnimationFrame(step);
        } else {
            renderBalanceValues(targetSats);
            // A fresh SVG clears edge artifacts left by the frame-by-frame fill.
            buildLogo(targetTiles);
            tileAnimationFrame = null;
        }
    };
    tileAnimationFrame = requestAnimationFrame(step);
}

// Addresses and balances
function normalizeAddress(value) {
    const address = value.trim();
    if (/^bc1/i.test(address)) {
        if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
            throw new Error('mixedCaseAddress');
        }
        const normalized = address.toLowerCase();
        if (normalized.length <= 90 && /^bc1[ac-hj-np-z02-9]{11,87}$/.test(normalized))
            return normalized;
    } else if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)) {
        return address;
    }
    throw new Error('invalidAddress');
}

function readAddresses() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(saved)) return [];
        const valid = new Set();
        for (const value of saved) {
            if (typeof value !== 'string') continue;
            try {
                valid.add(normalizeAddress(value));
            } catch (_) {}
            if (valid.size === MAX_ADDRESSES) break;
        }
        return [...valid];
    } catch (_) {
        return [];
    }
}

function readBalanceCache() {
    try {
        const saved = JSON.parse(localStorage.getItem(BALANCE_CACHE_KEY) || 'null');
        if (saved?.apiBase !== settings.apiBase || !Array.isArray(saved.entries)) return new Map();
        const validAddresses = new Set(addresses);
        const entries = saved.entries.filter((entry) => {
            if (!Array.isArray(entry) || entry.length !== 3) return false;
            const [address, sats, updatedAt] = entry;
            return (
                validAddresses.has(address) &&
                Number.isSafeInteger(sats) &&
                sats >= 0 &&
                Number.isSafeInteger(updatedAt) &&
                updatedAt > 0 &&
                updatedAt <= Date.now()
            );
        });
        return new Map(entries.map(([address, sats, updatedAt]) => [address, { sats, updatedAt }]));
    } catch (_) {
        return new Map();
    }
}

function saveBalanceCache() {
    try {
        const entries = addresses.flatMap((address) => {
            const value = cachedBalances.get(address);
            return value ? [[address, value.sats, value.updatedAt]] : [];
        });
        localStorage.setItem(
            BALANCE_CACHE_KEY,
            JSON.stringify({ apiBase: settings.apiBase, entries }),
        );
    } catch (_) {
        /* Balance caching is optional. */
    }
}

function cachedTotal() {
    if (addresses.length === 0) return null;
    let total = 0;
    for (const address of addresses) {
        const value = cachedBalances.get(address);
        if (!value) return null;
        total += value.sats;
        if (!Number.isSafeInteger(total)) return null;
    }
    return total;
}

function saveAddresses() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
        return true;
    } catch (_) {
        showMessage('saveAddressFailed');
        return false;
    }
}

function showMessage(key, values = {}) {
    currentMessage = key
        ? {
              key,
              values,
          }
        : null;
    $('message').textContent = key ? t(key, values) : '';
    $('message').hidden = !key;
}

function showCacheStatus(key) {
    cacheStatusKey = key;
    const node = $('cache-status');
    const isError = key === 'cacheUnavailable' || key === 'balanceLoadFailed';
    node.hidden = !isError;
    node.textContent = isError ? t(key) : '';
    updateExportAvailability();
}

function showCaughtError(error, fallbackKey) {
    const key =
        error instanceof Error && Object.hasOwn(messages, error.message)
            ? error.message
            : fallbackKey;
    showMessage(key, {
        max: MAX_ADDRESSES,
    });
}

function renderAddresses() {
    const list = $('address-list');
    list.replaceChildren();
    addresses.forEach((address, index) => {
        const item = document.createElement('li');
        item.className = 'address-item';
        const label = document.createElement('span');
        label.textContent = address;
        const remove = document.createElement('button');
        remove.className = 'remove-address';
        remove.type = 'button';
        remove.textContent = t('closeSymbol');
        remove.setAttribute(
            'aria-label',
            t('removeAddress', {
                number: index + 1,
            }),
        );
        remove.addEventListener('click', () => {
            const removed = addresses.splice(index, 1)[0];
            if (saveAddresses()) {
                balanceRequest++;
                cachedBalances.delete(removed);
                saveBalanceCache();
                renderAddresses();
                loadBalance();
            } else {
                addresses.splice(index, 0, removed);
                renderAddresses();
            }
        });
        item.append(label, remove);
        list.appendChild(item);
    });
    $('address-count').textContent = `${addresses.length} / ${MAX_ADDRESSES}`;
    $('empty-state').hidden = addresses.length > 0;
}

function group(value) {
    return integer.format(value);
}

function amount(sats) {
    const whole = Math.floor(sats / SATS_PER_BTC);
    return `${group(whole)}${decimalSeparator()}${String(sats % SATS_PER_BTC).padStart(8, '0')}`;
}

function percentage(filled) {
    return `${Math.floor(filled / 100)}${decimalSeparator()}${String(filled % 100).padStart(2, '0')}`;
}

function updateExportAvailability() {
    $('export').disabled =
        currentSats === null ||
        cacheStatusKey === 'cacheUpdating' ||
        cacheStatusKey === 'cacheUnavailable';
}

function clearBalance() {
    if (tileAnimationFrame !== null) cancelAnimationFrame(tileAnimationFrame);
    tileAnimationFrame = null;
    currentSats = null;
    displayedSats = null;
    buildLogo();
    $('tile-count').textContent = group(0);
    applySettingsVisibility();
    updateExportAvailability();
    showCacheStatus('');
}

function renderBalance(sats, animate = true) {
    currentSats = sats;
    applySettingsVisibility();
    updateExportAvailability();
    const filled = tilesFor(sats);
    if (animate) {
        animateBalance(sats, filled);
    } else {
        if (tileAnimationFrame !== null) cancelAnimationFrame(tileAnimationFrame);
        tileAnimationFrame = null;
        buildLogo(filled);
        renderBalanceValues(sats);
    }
}

async function fetchBalance(address, apiBase = settings.apiBase) {
    let response;
    try {
        response = await fetch(`${apiBase}/address/${encodeURIComponent(address)}`, {
            headers: {
                Accept: 'application/json',
            },
        });
    } catch (_) {
        throw new Error('addressConnectionFailed');
    }
    if (!response.ok) {
        if ([400, 404, 422].includes(response.status)) {
            throw new Error('addressNotFound');
        }
        if (response.status === 429) {
            throw new Error('rateLimited');
        }
        throw new Error('addressCheckFailed');
    }
    let data;
    try {
        data = await response.json();
    } catch (_) {
        throw new Error('addressCheckIncomplete');
    }
    const stats = data && data.chain_stats;
    if (
        !stats ||
        !Number.isSafeInteger(stats.funded_txo_sum) ||
        !Number.isSafeInteger(stats.spent_txo_sum) ||
        stats.funded_txo_sum < 0 ||
        stats.spent_txo_sum < 0 ||
        stats.spent_txo_sum > stats.funded_txo_sum
    ) {
        throw new Error('addressCheckIncomplete');
    }
    return stats.funded_txo_sum - stats.spent_txo_sum;
}

async function loadBalance({ animateCached = false } = {}) {
    const request = ++balanceRequest;
    if (addresses.length === 0) {
        clearBalance();
        showMessage('');
        return;
    }
    const total = cachedTotal();
    if (total !== null) {
        renderBalance(total, animateCached);
        showCacheStatus('');
    } else {
        clearBalance();
    }
    const stale = addresses.filter((address) => {
        const entry = cachedBalances.get(address);
        return !entry || Date.now() - entry.updatedAt >= CACHE_TTL_MS;
    });
    if (stale.length === 0) {
        showMessage('');
        return;
    }
    if (total !== null) showCacheStatus('cacheUpdating');
    const apiBase = settings.apiBase;
    const results = await Promise.allSettled(
        stale.map((address) => fetchBalance(address, apiBase)),
    );
    if (request !== balanceRequest) return;
    const updatedAt = Date.now();
    let firstError = null;
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            cachedBalances.set(stale[index], { sats: result.value, updatedAt });
        } else {
            firstError ??= result.reason;
        }
    });
    saveBalanceCache();
    const refreshedTotal = cachedTotal();
    if (refreshedTotal !== null && (total === null || refreshedTotal !== total)) {
        renderBalance(refreshedTotal, total === null || animateCached);
    }
    if (firstError) {
        showCacheStatus(refreshedTotal === null ? 'balanceLoadFailed' : 'cacheUnavailable');
        showCaughtError(firstError, 'balanceLoadFailed');
    } else {
        showCacheStatus('');
        showMessage('');
    }
}

// PNG export
function exportImage() {
    if (currentSats === null) return;
    const ns = 'http://www.w3.org/2000/svg';
    const styles = getComputedStyle(document.documentElement);
    const color = (name) => styles.getPropertyValue(name).trim();
    const paper = color('--paper');
    const ink = color('--ink');
    const orange = color('--orange');
    const tileEmpty = color('--tile-empty');
    const tileLine = color('--tile-line');
    const root = document.createElementNS(ns, 'svg');
    root.setAttribute('xmlns', ns);
    root.setAttribute('viewBox', '0 0 760 1080');
    root.setAttribute('width', '760');
    root.setAttribute('height', '1080');
    const add = (tag, attrs, text) => {
        const node = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        if (text !== undefined) node.textContent = text;
        root.appendChild(node);
        return node;
    };
    add('rect', {
        width: '760',
        height: '1080',
        fill: paper,
    });
    const logo = $('bitcoin').cloneNode(true);
    const filled = tilesFor(currentSats);
    const filledTiles = new Set(
        animationTiles
            .slice(0, filled)
            .map((tile) => `${tile.getAttribute('x')}:${tile.getAttribute('y')}`),
    );
    logo.setAttribute('x', '95');
    logo.setAttribute('y', '90');
    logo.setAttribute('width', '570');
    logo.setAttribute('height', '815');
    logo.removeAttribute('id');
    logo.removeAttribute('aria-label');
    logo.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    logo.querySelectorAll('rect').forEach((tile) => {
        const tileFilled = filledTiles.has(`${tile.getAttribute('x')}:${tile.getAttribute('y')}`);
        tile.setAttribute('fill', tileFilled ? orange : tileEmpty);
        tile.setAttribute('stroke', tileFilled ? orange : tileLine);
        tile.removeAttribute('class');
    });
    root.appendChild(logo);
    add(
        'text',
        {
            x: '380',
            y: '1015',
            'text-anchor': 'middle',
            'font-family': 'monospace',
            'font-size': '23',
            fill: ink,
        },
        `${amount(currentSats)} / ${goalBtcLabel()} BTC  ·  ${percentage(filled)} %`,
    );
    const svgUrl = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(root)], {
            type: 'image/svg+xml;charset=utf-8',
        }),
    );
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1520;
        canvas.height = 2160;
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `btc-journey-${new Date().toISOString().slice(0, 10)}.png`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    };
    image.onerror = () => URL.revokeObjectURL(svgUrl);
    image.src = svgUrl;
}

$('address-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const submitButton = event.currentTarget.querySelector('.add-address');
    try {
        const address = normalizeAddress($('address-input').value);
        if (addresses.includes(address)) throw new Error('duplicateAddress');
        if (addresses.length >= MAX_ADDRESSES) throw new Error('addressLimit');
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
        const apiBase = settings.apiBase;
        const sats = await fetchBalance(address, apiBase);
        if (apiBase !== settings.apiBase) throw new Error('addressCheckFailed');
        addresses.push(address);
        if (saveAddresses()) {
            balanceRequest++;
            cachedBalances.set(address, { sats, updatedAt: Date.now() });
            saveBalanceCache();
            $('address-input').value = '';
            renderAddresses();
            loadBalance();
        } else {
            addresses.pop();
            renderAddresses();
        }
    } catch (error) {
        showCaughtError(error, 'addAddressFailed');
    } finally {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
    }
});
$('export').addEventListener('click', exportImage);

// Startup
async function initialize() {
    try {
        try {
            messages = await loadLanguage(language);
        } catch (error) {
            console.error(error);
            const fallbackLanguage = LANGUAGES[language].fallback;
            messages = await loadLanguage(fallbackLanguage);
            language = fallbackLanguage;
            integer = new Intl.NumberFormat(numberLocale(), {
                maximumFractionDigits: 0,
            });
        }
        updateLanguageUI();
        buildLogo();
        updateExportAvailability();
        applyPresentationMode(settings.presentationMode);
        loadBalance({ animateCached: true });
    } catch (error) {
        console.error(error);
    } finally {
        document.documentElement.dataset.languageReady = 'true';
    }
}
initialize();
