// Global date safety: ensure any toLocale* calls never throw on Invalid Date
// This defuses rare cases where upstream UI code passes bad dates.

// Only run in environments where Date is available
(() => {
  try {
    const proto = Date.prototype as any;
    const origToLocaleString = proto.toLocaleString;
    const origToLocaleDateString = proto.toLocaleDateString;
    const origToLocaleTimeString = proto.toLocaleTimeString;

    function isInvalidDate(d: Date) {
      return !(d instanceof Date) || isNaN(d.getTime());
    }

    if (typeof origToLocaleString === "function") {
      proto.toLocaleString = function (...args: any[]) {
        try {
          if (isInvalidDate(this)) return "—";
          return origToLocaleString.apply(this, args);
        } catch {
          return "—";
        }
      };
    }

    if (typeof origToLocaleDateString === "function") {
      proto.toLocaleDateString = function (...args: any[]) {
        try {
          if (isInvalidDate(this)) return "—";
          return origToLocaleDateString.apply(this, args);
        } catch {
          return "—";
        }
      };
    }

    if (typeof origToLocaleTimeString === "function") {
      proto.toLocaleTimeString = function (...args: any[]) {
        try {
          if (isInvalidDate(this)) return "—";
          return origToLocaleTimeString.apply(this, args);
        } catch {
          return "—";
        }
      };
    }

    // Also guard Intl.DateTimeFormat.prototype.format
    try {
      const intlProto = (Intl.DateTimeFormat as any).prototype;
      const origFormat = intlProto?.format;
      if (typeof origFormat === "function") {
        intlProto.format = function (...args: any[]) {
          try {
            const v = args?.[0];
            if (v instanceof Date && isInvalidDate(v)) return "—";
            return origFormat.apply(this, args);
          } catch {
            return "—";
          }
        };
      }
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
})();
