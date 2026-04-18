const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m"
};

const levelStyles = {
    INFO: { color: colors.blue, method: console.log },
    SUCCESS: { color: colors.green, method: console.log },
    WARN: { color: colors.yellow, method: console.warn },
    ERROR: { color: colors.red, method: console.error },
    DEBUG: { color: colors.magenta, method: console.log }
};

function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function normalizeDetails(details) {
    if (!details) {
        return '';
    }

    if (details instanceof Error) {
        return details.stack || details.message;
    }

    if (typeof details === 'object') {
        try {
            return JSON.stringify(details, (key, value) => {
                if (value instanceof Error) {
                    return {
                        name: value.name,
                        message: value.message,
                        stack: value.stack
                    };
                }

                return value;
            });
        } catch {
            return String(details);
        }
    }

    return String(details);
}

function colorize(text, color, enabled) {
    if (!enabled) {
        return text;
    }

    return `${color}${colors.bright}${text}${colors.reset}`;
}

function dim(text, enabled) {
    if (!enabled) {
        return text;
    }

    return `${colors.dim}${text}${colors.reset}`;
}

function getDefaultDebugEnabled() {
    return typeof process !== 'undefined' && process?.env?.DEBUG === 'true';
}

function printLine(level, message, details, options) {
    const { scope = '', useColors = true } = options;
    const { color, method } = levelStyles[level];
    const prefix = scope ? `${colorize(`[${level}]`, color, useColors)} ${dim(`[${scope}]`, useColors)}` : colorize(`[${level}]`, color, useColors);
    const suffix = normalizeDetails(details);
    const detailText = suffix ? ` ${dim(suffix, useColors)}` : '';
    method(`[${getTimestamp()}] ${prefix} ${message}${detailText}`);
}

export function createLogger(options = {}) {
    const loggerOptions = {
        scope: options.scope || '',
        debugEnabled: options.debugEnabled ?? getDefaultDebugEnabled(),
        useColors: options.useColors ?? true
    };

    return {
        info(message, details = '') {
            printLine('INFO', message, details, loggerOptions);
        },

        success(message, details = '') {
            printLine('SUCCESS', message, details, loggerOptions);
        },

        warn(message, details = '') {
            printLine('WARN', message, details, loggerOptions);
        },

        error(message, details = '') {
            printLine('ERROR', message, details, loggerOptions);
        },

        debug(message, details = '') {
            if (!loggerOptions.debugEnabled) {
                return;
            }

            printLine('DEBUG', message, details, loggerOptions);
        }
    };
}

const logger = createLogger();

export default logger;
