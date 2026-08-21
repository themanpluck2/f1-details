let currentSessionKey = null;
let driverDirectory = {};

const standingsTableBody = document.getElementById('standing-body');
const gapTableBody = document.getElementById('gap-body');
const mapCanvas = document.getElementById('race-map');
const mapContext = mapCanvas ? mapCanvas.getContext('2d') : null;

async function getJson(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function fetchDriverStandings() {
    if (!standingsTableBody) return;

    const data = await getJson('https://api.jolpi.ca/ergast/f1/current/driverStandings.json');
    const standingsLists = data && data.MRData && data.MRData.StandingsTable
        ? (data.MRData.StandingsTable.StandingsLists || data.MRData.StandingsTable.StandingsList || [])
        : [];
    const drivers = standingsLists.length && standingsLists[0].DriverStandings
        ? standingsLists[0].DriverStandings
        : null;

    if (!drivers || drivers.length === 0) {
        standingsTableBody.innerHTML = "<tr><td colspan='4'>Standing Unavailable</td></tr>";
        return;
    }

    let tableHtml = '';
    for (let i = 0; i < drivers.length; i++) {
        const item = drivers[i];
        const driver = item.Driver || {};
        const givenName = driver.givenName || '';
        const familyName = driver.familyName || '';
        const name = (givenName + ' ' + familyName).trim() || 'Unknown';
        const team = item.Constructors && item.Constructors[0] ? item.Constructors[0].name : 'N/A';
        const pts = item.points !== undefined ? item.points : '-';

        tableHtml += '<tr>' +
            '<td>' + item.position + '</td>' +
            '<td>' + name + '</td>' +
            '<td>' + team + '</td>' +
            '<td>' + pts + '</td>' +
            '</tr>';
    }

    standingsTableBody.innerHTML = tableHtml;
}

async function startSession() {
    const sessions = await getJson('https://api.openf1.org/v1/sessions?session_key=latest');

    if (!sessions || !sessions.length) {
        if (gapTableBody) {
            gapTableBody.innerHTML = '<tr><td colspan="3">No live session right now</td></tr>';
        }
        return false;
    }

    currentSessionKey = sessions[0].session_key;

    const drivers = await getJson('https://api.openf1.org/v1/drivers?session_key=' + currentSessionKey);
    if (drivers && drivers.length) {
        driverDirectory = {};
        for (let i = 0; i < drivers.length; i++) {
            const driver = drivers[i];
            driverDirectory[String(driver.driver_number)] = driver;
        }
    }

    return true;
}

async function refreshLiveTiming() {
    if (!currentSessionKey || !gapTableBody) return;

    const positions = await getJson('https://api.openf1.org/v1/position?session_key=' + currentSessionKey);
    const intervals = await getJson('https://api.openf1.org/v1/intervals?session_key=' + currentSessionKey);

    if (!positions || !positions.length) {
        gapTableBody.innerHTML = '<tr><td colspan="3">No timing data active right now.</td></tr>';
        return;
    }

    const latestPosition = {};
    for (let i = 0; i < positions.length; i++) {
        latestPosition[String(positions[i].driver_number)] = positions[i].position;
    }

    const latestIntervals = {};
    if (intervals && intervals.length) {
        for (let i = 0; i < intervals.length; i++) {
            latestIntervals[String(intervals[i].driver_number)] = intervals[i].gap_to_leader;
        }
    }

    const rows = [];
    const driverNumbers = Object.keys(latestPosition);

    for (let i = 0; i < driverNumbers.length; i++) {
        const num = driverNumbers[i];
        const pos = latestPosition[num];
        const driver = driverDirectory[String(num)];
        const rawGap = latestIntervals[num];

        let gapDisplay = '-';
        if (pos === 1) {
            gapDisplay = 'LEADER';
        } else if (typeof rawGap === 'number') {
            gapDisplay = '+' + rawGap.toFixed(3) + 's';
        } else if (rawGap) {
            gapDisplay = '+' + rawGap;
        }

        const driverName = driver && (driver.broadcast_name || driver.full_name)
            ? (driver.broadcast_name || driver.full_name)
            : '#' + num;

        rows.push({
            position: Number(pos),
            name: driverName,
            gap: gapDisplay
        });
    }

    rows.sort((a, b) => a.position - b.position);

    let outputHtml = '';
    for (let i = 0; i < rows.length; i++) {
        outputHtml += '<tr>' +
            '<td>' + rows[i].position + '</td>' +
            '<td>' + rows[i].name + '</td>' +
            '<td>' + rows[i].gap + '</td>' +
            '</tr>';
    }

    gapTableBody.innerHTML = outputHtml;
}

async function drawTrack() {
    if (!mapCanvas || !mapContext || !currentSessionKey) return;

    const points = await getJson('https://api.openf1.org/v1/location?session_key=' + currentSessionKey);

    mapContext.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

    if (!points || !points.length) {
        mapContext.fillStyle = '#777777';
        mapContext.font = '14px Arial';
        mapContext.textAlign = 'center';
        mapContext.fillText('Waiting for telemetry...', mapCanvas.width / 2, mapCanvas.height / 2);
        return;
    }

    const latestPoints = {};
    for (let i = 0; i < points.length; i++) {
        latestPoints[String(points[i].driver_number)] = points[i];
    }

    const pointList = Object.values(latestPoints);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < pointList.length; i++) {
        const pt = pointList[i];
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
    }

    const widthDiff = (maxX - minX) || 1;
    const heightDiff = (maxY - minY) || 1;
    const padding = 35;
    const usableWidth = mapCanvas.width - (padding * 2);
    const usableHeight = mapCanvas.height - (padding * 2);

    const scaleX = usableWidth / widthDiff;
    const scaleY = usableHeight / heightDiff;
    const scale = Math.min(scaleX, scaleY) || 1;
    const centerOffsetX = padding - (minX * scale) + ((usableWidth - (widthDiff * scale)) / 2);
    const centerOffsetY = padding - (minY * scale) + ((usableHeight - (heightDiff * scale)) / 2);

    for (let i = 0; i < pointList.length; i++) {
        const pt = pointList[i];
        const driver = driverDirectory[String(pt.driver_number)];

        const posX = centerOffsetX + (pt.x - minX) * scale;
        const posY = mapCanvas.height - (centerOffsetY + (pt.y - minY) * scale);

        const carColor = driver && driver.team_colour ? '#' + driver.team_colour : '#e10600';

        mapContext.fillStyle = carColor;
        mapContext.beginPath();
        mapContext.arc(posX, posY, 5, 0, 2 * Math.PI);
        mapContext.fill();

        mapContext.fillStyle = '#ffffff';
        mapContext.font = '10px Arial';
        mapContext.textAlign = 'left';
        const tag = driver && driver.name_acronym ? driver.name_acronym : '#' + pt.driver_number;

        mapContext.fillText(tag, posX + 7, posY + 3);
    }
}

fetchDriverStandings();

startSession().then((hasActiveSession) => {
    if (hasActiveSession) {
        refreshLiveTiming();
        drawTrack();

        setInterval(() => {
            refreshLiveTiming();
            drawTrack();
        }, 5000);
    }
}).catch((error) => {
    console.error('Session initialization failed:', error);
});

//hey its me i just thought of writing some thing while i was writing this code//
//yoo i got the personal record of 16 error in a single file//
//now fixing those bugs//
//16 dropped to 12 errors//
//12 erorrs dropped to 9//
//9 errors dropped to 3//
//its the final 3//
//3 dropped to 1//
//the last one is hard god damn it//
//the last one has been eleminated//
//yayyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy//
