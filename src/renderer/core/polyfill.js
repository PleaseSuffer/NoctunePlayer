    // roundRect polyfill for older Chromium
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
            const R = Array.isArray(r) ? r[0] : (r || 0);
            this.beginPath();
            this.moveTo(x + R, y);
            this.lineTo(x + w - R, y);
            this.arcTo(x + w, y, x + w, y + R, R);
            this.lineTo(x + w, y + h - R);
            this.arcTo(x + w, y + h, x + w - R, y + h, R);
            this.lineTo(x + R, y + h);
            this.arcTo(x, y + h, x, y + h - R, R);
            this.lineTo(x, y + R);
            this.arcTo(x, y, x + R, y, R);
            this.closePath();
            return this;
        };
    }
