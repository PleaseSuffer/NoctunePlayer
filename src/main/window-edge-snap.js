// Separate capture and release distances stop the window oscillating at an edge.
function createEdgeSnap({ captureDistance = 12, releaseDistance = 21 } = {}) {
    let areaKey = '', horizontal = null, vertical = null;
    function reset() { areaKey = ''; horizontal = vertical = null; }
    function axis(position, start, end, attached) {
        if (attached !== null && Math.abs(position - (attached === 'start' ? start : end)) <= releaseDistance) {
            return { position: attached === 'start' ? start : end, attached };
        }
        const edge = Math.abs(position - start) <= Math.abs(position - end) ? 'start' : 'end';
        const target = edge === 'start' ? start : end;
        return Math.abs(position - target) <= captureDistance ? { position: target, attached: edge } : { position, attached: null };
    }
    function move(bounds, area) {
        const key = [area.x, area.y, area.width, area.height].join(',');
        if (areaKey !== key) { reset(); areaKey = key; }
        const x = axis(bounds.x, area.x, area.x + area.width - bounds.width, horizontal);
        const y = axis(bounds.y, area.y, area.y + area.height - bounds.height, vertical);
        horizontal = x.attached; vertical = y.attached;
        return { ...bounds, x: x.position, y: y.position };
    }
    return { move, reset };
}
module.exports = { createEdgeSnap };
