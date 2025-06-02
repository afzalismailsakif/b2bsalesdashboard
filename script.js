const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR5_ZuCTFWUvfyCNla7wmkg9O0BcM6IOW702XkVpOSbD3dc_4I1Hp1-hSaCLiW9u62wcYDSs9UE2faM/pub?output=csv';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MODERN_COLORS = [
  '#60a5fa', // Sky Blue
  '#fda4af', // Light Pink
  '#5eead4', // Teal
  '#fdba74', // Peach
  '#c4b5fd', // Lavender
  '#38bdf8', // Blue
  '#fb7185', // Red Pink
  '#34d399', // Green
  '#facc15', // Yellow
  '#818cf8'  // Indigo
];


const formatCurrency = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);

let salesData = [];
let filteredData = [];
let yearlySalesChart, monthlySalesChart, monthlyTargetChart;

const yearFilter = document.getElementById('yearFilter');
const monthFilter = document.getElementById('monthFilter');
const salespersonFilter = document.getElementById('salespersonFilter');
const applyFilters = document.getElementById('applyFilters');
const totalSalesElement = document.getElementById('totalSales');
const avgSalesElement = document.getElementById('avgSales');
const transactionCountElement = document.getElementById('transactionCount');
const topPerformerElement = document.getElementById('topPerformer');
const lastUpdatedElement = document.getElementById('lastUpdated');
const topPerformersTable = document.querySelector('#topPerformersTable tbody');
const salesTeamTable = document.querySelector('#salesTeamTable tbody');
const monthlySalesPersonTable = document.querySelector('#monthlySalesPersonTable tbody');

document.addEventListener('DOMContentLoaded', () => {
    applyFilters.addEventListener('click', applyDashboardFilters);
    document.querySelectorAll('.chart-toggle').forEach(btn => {
        btn.addEventListener('click', toggleChartVisibility);
    });
    loadData();
    lastUpdatedElement.textContent = `Last updated: ${new Date().toLocaleString()}`;
});

function toggleChartVisibility(e) {
    const chartId = e.currentTarget.getAttribute('data-chart');
    const chartCanvas = document.getElementById(chartId);
    const chartContainer = chartCanvas?.closest('.chart-container');
    if (chartContainer) {
        const isHidden = chartContainer.style.display === 'none';
        chartContainer.style.display = isHidden ? 'block' : 'none';
        e.currentTarget.innerHTML = isHidden ? '<i class="fas fa-eye"></i> Hide' : '<i class="fas fa-eye-slash"></i> Show';
    }
}

async function loadData() {
    try {
        const response = await fetch(`${SHEET_URL}&t=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const csv = await response.text();
        parseCSVData(csv);
        initializeFilters();
        applyDashboardFilters();
    } catch (err) {
        console.error('Error loading data', err);
    }
}

function parseCSVData(csv) {
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');
    salesData = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            const entry = {};
            for (let j = 0; j < headers.length; j++) {
                entry[headers[j].trim()] = values[j].trim();
            }
            entry['Sales amount'] = parseFloat(entry['Sales amount']) || 0;
            entry['Month'] = parseInt(entry['Month']) || 1;
            salesData.push(entry);
        }
    }
}

function initializeFilters() {
    yearFilter.innerHTML = '<option value="all">All Years</option>';
    monthFilter.innerHTML = '<option value="all">All Months</option>';
    salespersonFilter.innerHTML = '<option value="all">All Team</option>';

    const years = [...new Set(salesData.map(x => x['Sales year']))];
    years.forEach(y => yearFilter.innerHTML += `<option value="${y}">${y}</option>`);
    MONTH_NAMES.forEach((m, i) => monthFilter.innerHTML += `<option value="${i + 1}">${m}</option>`);
    const people = [...new Set(salesData.map(x => x['Sales person name']))];
    people.forEach(p => salespersonFilter.innerHTML += `<option value="${p}">${p}</option>`);
}

function applyDashboardFilters() {
    const y = yearFilter.value;
    const m = monthFilter.value;
    const p = salespersonFilter.value;
    filteredData = salesData.filter(row =>
        (y === 'all' || row['Sales year'] === y) &&
        (m === 'all' || row['Month'] === parseInt(m)) &&
        (p === 'all' || row['Sales person name'] === p)
    );
    updateSummary();
    updateCharts();
    updateTopPerformersTable();
    updateSalesTeamTable();
    updateMonthlySalesBySalespersonTable();
}

function updateCharts() {
    updateYearlySalesChart();
    updateMonthlySalesChart();
    updateMonthlySalesTargetChart();
}

function updateSummary() {
    const total = filteredData.reduce((sum, x) => sum + x['Sales amount'], 0);
    const avg = filteredData.length ? total / filteredData.length : 0;
    const top = getTopPerformer(filteredData);
    totalSalesElement.textContent = formatCurrency(total);
    avgSalesElement.textContent = formatCurrency(avg);
    transactionCountElement.textContent = filteredData.length;
    topPerformerElement.textContent = top ? `${top.name} (${formatCurrency(top.amount)})` : '-';
    updateCustomYearSales();
}

function getTopPerformer(data) {
    const totals = {};
    data.forEach(d => {
        const name = d['Sales person name'];
        totals[name] = (totals[name] || 0) + d['Sales amount'];
    });
    return Object.entries(totals).reduce((best, [name, amount]) =>
        amount > best.amount ? { name, amount } : best, { name: '', amount: 0 }
    );
}

function updateYearlySalesChart() {
    const ctx = document.getElementById('yearlySalesChart').getContext('2d');
    const salespeople = [...new Set(filteredData.map(d => d['Sales person name']))].sort();
    const years = [...new Set(filteredData.map(d => d['Sales year']))].sort();
    const yearlyTotals = {};

    salespeople.forEach(person => {
        yearlyTotals[person] = {};
        years.forEach(year => yearlyTotals[person][year] = 0);
    });

    filteredData.forEach(item => {
        yearlyTotals[item['Sales person name']][item['Sales year']] += item['Sales amount'];
    });

    const datasets = salespeople.map((person, i) => {
  const color = MODERN_COLORS[i % MODERN_COLORS.length]; // dynamically cycle through colors
  return {
    label: person,
    data: years.map(y => yearlyTotals[person][y]),
    backgroundColor: color,
    borderColor: color,
    borderWidth: 1,
    borderRadius: 6
  };
});


    if (yearlySalesChart) {
        yearlySalesChart.data.labels = years;
        yearlySalesChart.data.datasets = datasets;
        yearlySalesChart.update();
    } else {
        yearlySalesChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: years, datasets },
            options: {
                plugins: {
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
                },
                scales: {
                    y: { ticks: { callback: value => formatCurrency(value) } }
                }
            }
        });
    }
}

function updateMonthlySalesChart() {
    const ctx = document.getElementById('monthlySalesChart').getContext('2d');
    const monthlyTotals = Array(12).fill(0);
    filteredData.forEach(item => monthlyTotals[item['Month'] - 1] += item['Sales amount']);

    if (monthlySalesChart) {
        monthlySalesChart.data.datasets[0].data = monthlyTotals;
        monthlySalesChart.update();
    } else {
        monthlySalesChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: MONTH_NAMES,
                datasets: [{
                    label: 'Monthly Sales',
                    data: monthlyTotals,
                    borderColor: 'rgba(75,192,192,1)',
                    backgroundColor: 'rgba(75,192,192,0.2)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                plugins: {
                    tooltip: { callbacks: { label: ctx => `Sales: ${formatCurrency(ctx.raw)}` } }
                },
                scales: {
                    y: { ticks: { callback: value => formatCurrency(value) } }
                }
            }
        });
    }
}

function updateMonthlySalesTargetChart() {
    const ctx = document.getElementById('monthlyTargetChart').getContext('2d');
    const targets = [35000, 35000, 35000, 20000, 20000, 35000, 35000, 35000, 35000, 35000, 35000, 35000];
    const actuals = Array(12).fill(0);

    filteredData.forEach(d => actuals[d['Month'] - 1] += d['Sales amount']);

    const percent = actuals.map((v, i) => {
        const pct = targets[i] ? (v / targets[i]) * 100 : 0;
        return Math.round(pct * 10) / 10; // round to 1 decimal
    });

    const backgroundColors = percent.map(p => {
        if (p < 20) return '#f72585';         // Red
        else if (p <= 50) return '#fbbf24';   // Yellow
        else if (p < 80) return '#a3e635';    // Light Green
        else return '#22c55e';                // Green
    });

    if (monthlyTargetChart) {
        monthlyTargetChart.data.labels = MONTH_NAMES;
        monthlyTargetChart.data.datasets[0].data = percent;
        monthlyTargetChart.data.datasets[0].backgroundColor = backgroundColors;
        monthlyTargetChart.update();
    } else {
        monthlyTargetChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: MONTH_NAMES,
                datasets: [{
                    label: '% Achieved',
                    data: percent,
                    backgroundColor: backgroundColors,
                    borderRadius: 5
                }]
            },
            options: {
                indexAxis: 'y',
                scales: {
                    x: {
                        min: 0,
                        max: 150,
                        ticks: {
                            callback: v => `${v}%`
                        },
                        title: {
                            display: true,
                            text: 'Percentage Achieved'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.raw.toFixed(1)}%`
                        }
                    },
                    legend: { display: false },
                    title: { display: false }
                }
            }
        });
    }
}




function updateTopPerformersTable() {
    const monthly = Array.from({ length: 12 }, (_, i) => {
        const rows = filteredData.filter(d => d.Month === i + 1);
        const totals = {};
        let monthTotal = 0;
        rows.forEach(r => {
            const name = r['Sales person name'];
            totals[name] = (totals[name] || 0) + r['Sales amount'];
            monthTotal += r['Sales amount'];
        });

        const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
        return top ? {
            month: MONTH_NAMES[i],
            name: top[0],
            total: top[1],
            percent: (top[1] / monthTotal) * 100
        } : null;
    }).filter(Boolean);

    topPerformersTable.innerHTML = monthly.map(m =>
        `<tr><td>${m.month}</td><td>${m.name}</td><td>${formatCurrency(m.total)}</td><td>${m.percent.toFixed(1)}%</td></tr>`
    ).join('');
}

function updateSalesTeamTable() {
    const team = {};
    filteredData.forEach(d => {
        const name = d['Sales person name'];
        if (!team[name]) team[name] = { total: 0, count: 0 };
        team[name].total += d['Sales amount'];
        team[name].count += 1;
    });

    salesTeamTable.innerHTML = Object.entries(team).map(([name, { total, count }]) => `
        <tr>
            <td>${name}</td>
            <td>${formatCurrency(total)}</td>
            <td>${formatCurrency(total / count || 0)}</td>
            <td>${count}</td>
        </tr>
    `).join('');
}

function updateMonthlySalesBySalespersonTable() {
    const data = {};
    filteredData.forEach(d => {
        const name = d['Sales person name'];
        const month = d.Month - 1;
        if (!data[name]) data[name] = Array(12).fill(0);
        data[name][month] += d['Sales amount'];
    });

    monthlySalesPersonTable.innerHTML = Object.entries(data).map(([name, values]) => `
        <tr>
            <td>${name}</td>
            ${values.map(v => `<td>${v ? formatCurrency(v) : '-'}</td>`).join('')}
        </tr>
    `).join('');
}

document.getElementById('exportDashboardPNG').addEventListener('click', () => {
    const dashboard = document.querySelector('.dashboard-container');
    dashboard.classList.add('export-mode');

    html2canvas(dashboard, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        dashboard.classList.remove('export-mode');
        const link = document.createElement('a');
        link.download = 'sales-dashboard.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
});



document.getElementById('exportDashboardPDF').addEventListener('click', () => {
    const dashboard = document.querySelector('.dashboard-container');
    dashboard.classList.add('export-mode');

    html2canvas(dashboard, {
        scale: 1,
        useCORS: true,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        dashboard.classList.remove('export-mode');
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = canvas.height * imgWidth / canvas.width;

        let heightLeft = imgHeight;
        let position = 0;

        while (heightLeft > 0) {
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
            if (heightLeft > 0) {
                pdf.addPage();
                position = 0;
            }
        }

        pdf.save('sales-dashboard.pdf');
    });
});


function updateCustomYearSales() {
    const currentYear = new Date().getFullYear();
    const customYear = parseInt(yearFilter.value) || currentYear;

    // Sales Year is Feb (customYear) to Jan (customYear + 1)
    const customYearData = salesData.filter(d => {
        const saleYear = parseInt(d['Sales year']);
        const month = parseInt(d['Month']);
        return (
            (saleYear === customYear && month >= 2) ||
            (saleYear === customYear + 1 && month === 1)
        );
    });

    const customTotal = customYearData.reduce((sum, d) => sum + d['Sales amount'], 0);
    const customSalesElement = document.getElementById('customYearSales');
    customSalesElement.textContent = formatCurrency(customTotal);
}
