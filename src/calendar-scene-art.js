// 日历状态卡的配图：天气是分层扁平风景画，生理期是按天切分的周期圆环。
// 只输出几何与 class，颜色全部由 styles/calendar.css 的私有 token 决定。

const W = 280, H = 150;

const ridge = (points, layer) => {
    let d = `M${points[0][0]} ${H} L${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i += 1) {
        const [x, y] = points[i], [nx, ny] = points[i + 1];
        d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
    }
    const last = points.at(-1);
    return `<path class="${layer}" d="${d} L${last[0]} ${last[1]} L${last[0]} ${H} Z"/>`;
};
const peaks = (points, layer) => `<polygon class="${layer}" points="${points.map(point => point.join(',')).join(' ')} ${points.at(-1)[0]},${H} ${points[0][0]},${H}"/>`;
const cloud = (x, y, scale, layer) => `<g class="${layer}" transform="translate(${x} ${y}) scale(${scale})"><circle cx="10" cy="10" r="8"/><circle cx="21" cy="6" r="10"/><circle cx="32" cy="11" r="7"/><rect x="2" y="9" width="37" height="9" rx="4.5"/></g>`;
const water = top => `<rect class="is-water" x="0" y="${top}" width="${W}" height="${H - top}"/><g class="is-glint"><rect x="160" y="${top + 9}" width="34" height="2" rx="1"/><rect x="206" y="${top + 16}" width="22" height="2" rx="1"/><rect x="120" y="${top + 20}" width="18" height="2" rx="1"/></g>`;
const trees = (items, layer) => items.map(([x, y, h]) => `<polygon class="${layer}" points="${x},${y - h} ${x + h * 0.32},${y} ${x - h * 0.32},${y}"/>`).join('');
const rain = (x0, x1, y0, y1, count) => {
    let lines = '';
    for (let i = 0; i < count; i += 1) {
        const x = x0 + ((i * 37) % (x1 - x0)), y = y0 + ((i * 53) % (y1 - y0));
        lines += `<line x1="${x}" y1="${y}" x2="${x - 3}" y2="${y + 9}"/>`;
    }
    return `<g class="is-rain">${lines}</g>`;
};
const dots = items => `<g class="is-flake">${items.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2"/>`).join('')}</g>`;

const SCENES = {
    clear: () => `<circle class="is-halo" cx="222" cy="44" r="25"/><circle class="is-sun" cx="222" cy="44" r="15"/>
        ${ridge([[110, 150], [150, 104], [190, 88], [232, 70], [280, 84]], 'is-far')}
        ${ridge([[0, 124], [60, 114], [130, 106], [200, 100], [280, 110]], 'is-near')}
        ${water(124)}
        ${ridge([[0, 136], [50, 128], [96, 132], [96, 150]], 'is-front')}
        ${trees([[22, 131, 15], [34, 129, 20], [46, 130, 13]], 'is-tree')}`,
    cloudy: () => `<circle class="is-sun" cx="214" cy="40" r="14"/>${cloud(196, 34, 1.5, 'is-cloud')}${cloud(150, 58, 0.9, 'is-cloud-soft')}
        ${ridge([[100, 150], [146, 100], [198, 86], [240, 76], [280, 90]], 'is-far')}
        ${ridge([[0, 122], [70, 112], [140, 108], [210, 102], [280, 112]], 'is-near')}
        ${water(126)}
        ${ridge([[0, 138], [44, 130], [90, 134], [90, 150]], 'is-front')}`,
    rain: () => `${cloud(176, 16, 2.1, 'is-cloud')}
        ${ridge([[110, 150], [150, 96], [196, 84], [238, 72], [280, 86]], 'is-far')}
        <rect class="is-mist" x="0" y="108" width="${W}" height="10"/>
        ${ridge([[0, 118], [70, 112], [140, 110], [210, 106], [280, 114]], 'is-near')}
        ${water(128)}
        ${rain(150, 276, 56, 120, 22)}`,
    snow: () => `${peaks([[110, 150], [150, 92], [175, 108], [215, 62], [250, 96], [280, 80]], 'is-far')}
        <polygon class="is-snowcap" points="215,62 231.5,78 224,74 218,80 210,74 201.1,78"/>
        <polygon class="is-snowcap" points="150,92 168.75,104 162,101 156,106 149,101 141.7,104"/>
        ${ridge([[0, 124], [80, 116], [160, 114], [240, 110], [280, 114]], 'is-near')}
        ${trees([[178, 122, 20], [192, 124, 15], [60, 128, 16], [72, 127, 22]], 'is-tree')}
        ${dots([[160, 40], [188, 30], [246, 36], [262, 58], [172, 66], [234, 20], [140, 54], [204, 48]])}`,
    fog: () => `<circle class="is-sun" cx="220" cy="46" r="14"/>
        ${ridge([[120, 150], [160, 96], [205, 86], [245, 80], [280, 90]], 'is-far')}
        <rect class="is-mist" x="0" y="102" width="${W}" height="8"/>
        ${ridge([[60, 150], [110, 112], [170, 108], [230, 104], [280, 112]], 'is-near')}
        <rect class="is-mist" x="0" y="120" width="${W}" height="7"/>
        ${ridge([[0, 130], [60, 126], [130, 124], [200, 128], [280, 124]], 'is-front')}`,
    storm: () => `${cloud(170, 12, 2.3, 'is-cloud')}
        <polygon class="is-bolt" points="226,52 214,76 223,76 216,96 236,68 226,68 233,52"/>
        ${ridge([[100, 150], [146, 98], [192, 88], [236, 78], [280, 92]], 'is-far')}
        ${ridge([[0, 122], [70, 114], [140, 112], [210, 108], [280, 116]], 'is-near')}
        ${water(130)}
        ${rain(140, 276, 62, 124, 20)}`,
};

export function weatherSceneKind(code) {
    const weatherCode = Number(code);
    if (weatherCode === 0) return 'clear';
    if (weatherCode === 1 || weatherCode === 2 || weatherCode === 3) return 'cloudy';
    if (weatherCode === 45 || weatherCode === 48) return 'fog';
    if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return 'snow';
    if ([95, 96, 99].includes(weatherCode)) return 'storm';
    return 'rain';
}

export function weatherSceneSvg(kind) {
    const draw = SCENES[kind] || SCENES.rain;
    return `<svg class="pm-calendar-scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect class="is-sky" width="${W}" height="${H}"/>${draw()}</svg>`;
}

// 圆环：周期多少天就切多少段，段间缝宽一致，一段即一天。
export function cycleRingSvg({ cycleLength, today, phaseOf }) {
    const days = Math.max(1, Math.round(Number(cycleLength) || 28));
    const radius = 38, center = 46, step = 360 / days, gap = Math.min(2.4, step * 0.3);
    const point = angle => {
        const radian = (angle - 90) * Math.PI / 180;
        return [center + radius * Math.cos(radian), center + radius * Math.sin(radian)].map(value => value.toFixed(2));
    };
    let arcs = '';
    for (let index = 0; index < days; index += 1) {
        const day = index + 1;
        const [x0, y0] = point(index * step + gap / 2), [x1, y1] = point((index + 1) * step - gap / 2);
        const phase = phaseOf(day);
        const layer = day === today ? 'is-today' : phase === 'period' ? 'is-period' : phase === 'ovulatory' ? 'is-fertile' : 'is-rest';
        arcs += `<path class="${layer}" d="M${x0} ${y0} A${radius} ${radius} 0 0 1 ${x1} ${y1}"/>`;
    }
    return `<svg class="pm-calendar-ring-art" viewBox="0 0 92 92" aria-hidden="true" focusable="false">${arcs}</svg>`;
}
