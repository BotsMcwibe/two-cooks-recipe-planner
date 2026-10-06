export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}

export function formatNiceAmount(amount, unitAbbr) {
  const tiny = ['nypa', 'skvätt', 'klick', 'tsk', 'msk'];
  const isCount = ['st', 'pkt', 'burk', 'kruka', 'huvud', 'skiva'].includes(unitAbbr);
  let rounded = amount;
  if (tiny.includes(unitAbbr) || isCount) {
    rounded = Math.round(amount * 2) / 2;
  } else if (amount >= 10) {
    rounded = Math.round(amount);
  } else if (amount >= 1) {
    rounded = Math.round(amount * 10) / 10;
  } else {
    rounded = Math.round(amount * 100) / 100;
  }
  const toFraction = (val) => {
    if (Math.abs(val - Math.floor(val) - 0.5) < 1e-9) {
      const whole = Math.floor(val);
      return whole === 0 ? '½' : `${whole}½`;
    }
    return `${val}`;
  };
  const disp = (tiny.includes(unitAbbr) || isCount) ? toFraction(rounded) : `${rounded}`;
  return `${disp} ${unitAbbr}`.trim();
}
