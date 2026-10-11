function compareThemeVersions(left, right) {
    const parse = value => {
        const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
        return match && { parts: match[1].split('.').map(BigInt), pre: match[2]?.split('.') };
    };
    const a = parse(left), b = parse(right);
    if (!a || !b) return left === right ? 0 : null;
    for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
        const x = a.parts[i] || 0n, y = b.parts[i] || 0n;
        if (x !== y) return x > y ? 1 : -1;
    }
    if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const x = a.pre[i], y = b.pre[i];
        if (x === y) continue;
        if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
        const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
        if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
        if (nx !== ny) return nx ? -1 : 1;
        return x > y ? 1 : -1;
    }
    return 0;
}
module.exports = { compareThemeVersions };
