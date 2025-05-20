// Configuration - Replace with your Google Sheets published URL
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR5_ZuCTFWUvfyCNla7wmkg9O0BcM6IOW702XkVpOSbD3dc_4I1Hp1-hSaCLiW9u62wcYDSs9UE2faM/pub?output=csv';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHLY_TARGETS = {
    1: 0, 2: 35000, 3: 35000, 4: 20000, 5: 20000, 6: 35000,
    7: 35000, 8: 35000, 9: 35000, 10: 35000, 11: 35000, 12: 35000
};

const formatCurrency = (value) => new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
}).format(value);

// Global Variables
let salesData = [];
let filteredData = [];
let yearlySalesChart, monthlySalesChart;

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
const monthlyTargetTable = document.querySelector('#monthlyTargetTable tbody');

document.addEventListener('DOMContentLoaded', function () {
    applyFilters.addEventListener('click', applyDashboardFilters);
    document.querySelectorAll('.chart-toggle').forEach(btn => {
        btn.addEventListener('click', toggleChartVisibility);
    });

    loadData();
});

function toggleChartVisibility(e) {
    const button = e.currentTarget;
    const chartId = button.getAttribute('data-chart');
    const chartContainer = document.getElementById(chartId)?.parentElement;

    if (chartContainer) {
        const isVisible = chartContainer.style.display !== 'none';
        chartContainer.style.display = isVisible ? 'none' : 'block';
        button.innerHTML = isVisible
            ? '<i class="fas fa-eye-slash"></i> Show'
            : '<i class="fas fa-eye"></i> Hide';
    }
}

async function loadData() {
    try {
        const response = await fetch(`${SHEET_URL}&t=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const csvData = await response.text();
        parseCSVData(csvData);
        initializeFilters();
        applyDashboardFilters();
        lastUpdatedElement.textContent = `Last updated: ${new Date().toLocaleString()}`;
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

function parseCSVData(csv) {
    const lines = csv.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    salesData = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            const entry = {};
            headers.forEach((header, j) => {
                entry[header] = values[j].trim();
            });
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

    const years = [...new Set(salesData.map(item => item['Sales year']))].sort();
    const salespeople = [...new Set(salesData.map(item => item['Sales person name']))].sort();

    years.forEach(year => {
        yearFilter.innerHTML += `<option value="${year}">${year}</option>`;
    });

    MONTH_NAMES.forEach((name, index) => {
        monthFilter.innerHTML += `<option value="${index + 1}">${name}</option>`;
    });

    salespeople.forEach(person => {
        salespersonFilter.innerHTML += `<option value="${person}">${person}</option>`;
    });
}

function applyDashboardFilters() {
    const selectedYear = yearFilter.value;
    const selectedMonth = monthFilter.value;
    const selectedSalesperson = salespersonFilter.value;

    filteredData = salesData.filter(item =>
        (selectedYear === 'all' || item['Sales year'] === selectedYear) &&
        (selectedMonth === 'all' || item['Month'] === parseInt(selectedMonth)) &&
        (selectedSalesperson === 'all' || item['Sales person name'] === selectedSalesperson)
    );

    updateSummary();
    updateCharts();
    updatePerformanceTables();
}

function updateSummary() {
    const total = filteredData.reduce((sum, item) => sum + item['Sales amount'], 0);
    const avg = filteredData.length > 0 ? total / filteredData.length : 0;
    const top = getTopPerformer(filteredData);

    totalSalesElement.textContent = formatCurrency(total);
    avgSalesElement.textContent = formatCurrency(avg);
    transactionCountElement.textContent = filteredData.length;
    topPerformerElement.textContent = top ? `${top.name} (${formatCurrency(top.amount)})` : '-';
}

function getTopPerformer(data) {
    const salesByPerson = {};
    data.forEach(item => {
        const name = item['Sales person name'];
        salesByPerson[name] = (salesByPerson[name] || 0) + item['Sales amount'];
    });

    let topName = '', topAmount = 0;
    for (const [name, amount] of Object.entries(salesByPerson)) {
        if (amount > topAmount) {
            topAmount = amount;
            topName = name;
        }
    }
    return { name: topName, amount: topAmount };
}

function updateCharts() {
    updateYearlySalesChart();
    updateMonthlySalesChart();
    updateMonthlyTargetChart();
}

function updateYearlySalesChart() {
    const ctx = document.getElementById('yearlySalesChart').getContext('2d');
    const years = [...new Set(filteredData.map(item => item['Sales year']))].sort();
    const salespeople = [...new Set(filteredData.map(item => item['Sales person name']))].sort();

    const yearlyData = salespeople.map((person, index) => {
        const data = years.map(year =>
            filteredData.filter(item => item['Sales person name'] === person && item['Sales year'] === year)
                .reduce((sum, item) => sum + item['Sales amount'], 0)
        );
        const color = `hsl(${index * 50}, 70%, 60%)`;
        return { label: person, data, backgroundColor: color };
    });

    if (yearlySalesChart) {
        yearlySalesChart.data = { labels: years, datasets: yearlyData };
        yearlySalesChart.update();
    } else {
        yearlySalesChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: years, datasets: yearlyData },
            options: {
                plugins: {
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
                },
                scales: {
                    y: { ticks: { callback: val => formatCurrency(val) } }
                }
            }
        });
    }
}

function updateMonthlySalesChart() {
    const ctx = document.getElementById('monthlySalesChart').getContext('2d');
    const monthlySales = Array(12).fill(0);

    filteredData.forEach(item => {
        monthlySales[item.Month - 1] += item['Sales amount'];
    });

    const data = {
        labels: MONTH_NAMES,
        datasets: [{
            label: 'Monthly Sales',
            data: monthlySales,
            backgroundColor: 'rgba(75,192,192,0.2)',
            borderColor: 'rgba(75,192,192,1)',
            fill: true,
            tension: 0.4
        }]
    };

    if (monthlySalesChart) {
        monthlySalesChart.data = data;
        monthlySalesChart.update();
    } else {
        monthlySalesChart = new Chart(ctx, {
            type: 'line',
            data,
            options: {
                plugins: {
                    tooltip: { callbacks: { label: ctx => `Sales: ${formatCurrency(ctx.raw)}` } }
                },
                scales: {
                    y: { ticks: { callback: val => formatCurrency(val) } }
                }
            }
        });
    }
}

function updateMonthlyTargetChart() {
    const ctx = document.getElementById('monthlyTargetChart').getContext('2d');
    const monthlyTotals = Array(12).fill(0);
    filteredData.forEach(item => {
        monthlyTotals[item.Month - 1] += item['Sales amount'];
    });

    const achieved = monthlyTotals.map((sales, idx) => {
        const target = MONTHLY_TARGETS[idx + 1] || 1;
        return Math.round((sales / target) * 100);
    });

    const dataset = {
        labels: MONTH_NAMES,
        datasets: [{
            label: '% Target Achieved',
            data: achieved,
            backgroundColor: achieved.map(p => p >= 100 ? 'rgba(40,167,69,0.7)' : 'rgba(255,99,132,0.7)')
        }]
    };

    if (window.monthlyTargetChart) {
        window.monthlyTargetChart.data = dataset;
        window.monthlyTargetChart.update();
    } else {
        window.monthlyTargetChart = new Chart(ctx, {
            type: 'bar',
            data: dataset,
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 150,
                        ticks: { callback: v => `${v}%` },
                        title: { display: true, text: '% of Target' }
                    }
                }
            }
        });
    }

    // Also populate the table
    monthlyTargetTable.innerHTML = '';
    achieved.forEach((percent, i) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${MONTH_NAMES[i]}</td>
            <td>${formatCurrency(monthlyTotals[i])}</td>
            <td>${formatCurrency(MONTHLY_TARGETS[i + 1])}</td>
            <td>${percent}%</td>
        `;
        monthlyTargetTable.appendChild(row);
    });
}

function updatePerformanceTables() {
    updateTopPerformersTable();
    updateSalesTeamTable();
    updateMonthlySalesBySalespersonTable();
}

function updateTopPerformersTable() {
    topPerformersTable.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const monthData = filteredData.filter(d => d.Month === m);
        if (monthData.length === 0) continue;

        const total = monthData.reduce((sum, item) => sum + item['Sales amount'], 0);
        const salesByPerson = {};

        monthData.forEach(item => {
            const name = item['Sales person name'];
            salesByPerson[name] = (salesByPerson[name] || 0) + item['Sales amount'];
        });

        const topName = Object.keys(salesByPerson).reduce((a, b) => salesByPerson[a] > salesByPerson[b] ? a : b);
        const topAmount = salesByPerson[topName];
        const percent = (topAmount / total) * 100;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${MONTH_NAMES[m - 1]}</td>
            <td>${topName}</td>
            <td>${formatCurrency(topAmount)}</td>
            <td>${percent.toFixed(1)}%</td>
        `;
        topPerformersTable.appendChild(row);
    }
}

function updateSalesTeamTable() {
    salesTeamTable.innerHTML = '';
    const stats = {};

    filteredData.forEach(item => {
        const name = item['Sales person name'];
        stats[name] = stats[name] || { total: 0, count: 0 };
        stats[name].total += item['Sales amount'];
        stats[name].count++;
    });

    Object.entries(stats).forEach(([name, stat]) => {
        const avg = stat.total / stat.count;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            <td>${formatCurrency(stat.total)}</td>
            <td>${formatCurrency(avg)}</td>
            <td>${stat.count}</td>
        `;
        salesTeamTable.appendChild(row);
    });
}

function updateMonthlySalesBySalespersonTable() {
    const table = document.querySelector('#monthlySalesPersonTable tbody');
    table.innerHTML = '';

    const map = {};
    filteredData.forEach(item => {
        const name = item['Sales person name'];
        const month = item.Month;
        map[name] = map[name] || Array(12).fill(0);
        map[name][month - 1] += item['Sales amount'];
    });

    Object.entries(map).forEach(([name, values]) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${name}</td>` + values.map(v =>
            `<td>${v > 0 ? formatCurrency(v) : '-'}</td>`).join('');
        table.appendChild(row);
    });
}
