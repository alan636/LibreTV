/**
 * LibreTV 后端诊断日志模块
 * 负责统一格式化输出、带颜色显示及错误分级
 */

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m"
};

const getTimestamp = () => {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
};

export const logger = {
    info: (msg, details = '') => {
        const time = getTimestamp();
        console.log(`[${time}] ${colors.blue}${colors.bright}[INFO]${colors.reset} ${msg} ${colors.dim}${details}${colors.reset}`);
    },

    success: (msg, duration = '') => {
        const time = getTimestamp();
        const durStr = duration ? `(${duration}ms)` : '';
        console.log(`[${time}] ${colors.green}${colors.bright}[SUCCESS]${colors.reset} ${msg} ${colors.cyan}${durStr}${colors.reset}`);
    },

    warn: (msg, details = '') => {
        const time = getTimestamp();
        console.warn(`[${time}] ${colors.yellow}${colors.bright}[WARN]${colors.reset} ${msg} ${colors.dim}${details}${colors.reset}`);
    },

    error: (status, msg, target = '') => {
        const time = getTimestamp();
        const statusStr = status ? ` [${status}]` : '';
        console.error(`[${time}] ${colors.red}${colors.bright}[ERROR${statusStr}]${colors.reset} ${colors.red}${msg}${colors.reset} ${colors.dim}| 目标: ${target}${colors.reset}`);
    },

    debug: (msg, data = null) => {
        if (process.env.DEBUG === 'true') {
            const time = getTimestamp();
            console.log(`[${time}] ${colors.magenta}[DEBUG]${colors.reset} ${msg}`, data || '');
        }
    }
};

export default logger;
