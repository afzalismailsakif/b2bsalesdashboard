// Configuration - Replace with your Google Sheets published URL
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR5_ZuCTFWUvfyCNla7wmkg9O0BcM6IOW702XkVpOSbD3dc_4I1Hp1-hSaCLiW9u62wcYDSs9UE2faM/pub?output=csv';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Currency formatter for GBP
const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP'
    }).format(value);
};

// Global variables
let salesData = [];
let filteredData = [];
let yearlySalesChart, monthlySalesChart;

// DOM Elements
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

document.addEventListener('DOMContentLoaded', function () {
    applyFilters.addEventListener('click', applyDashboardFilters);
    document.querySelectorAll('.chart-toggle').forEach(btn => {
        btn.addEventListener('click', toggleChartVisibility);
    });

    loadData();
    lastUpdatedElement.textContent = `Last updated: ${new Date().toLocaleString()}`;
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
        const sheetUrl = `${SHEET_URL}&t=${Date.now()}`;
        const response = await fetch(sheetUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const csvData = await response.text();
        parseCSVData(csvData);
        initializeFilters();
        applyDashboardFilters();
        lastUpdatedElement.textContent = `Last updated: ${new Date().toLocaleString()}`;
    } catch (error) {
        console.error('Error loading data:', error);
        console.warn("Using test data instead");
        loadTestData();
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
            for (let j = 0; j < headers.length; j++) {
                entry[headers[j]] = values[j].trim();
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

    const years = [...new Set(salesData.map(item => item['Sales year']))].sort();
    const salespeople = [...new Set(salesData.map(item => item['Sales person name']))].sort();

    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearFilter.appendChild(option);
    });

    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i + 1;
        option.textContent = MONTH_NAMES[i];
        monthFilter.appendChild(option);
    }

    salespeople.forEach(person => {
        const option = document.createElement('option');
        option.value = person;
        option.textContent = person;
        salespersonFilter.appendChild(option);
    });
}

function applyDashboardFilters() {
    const selectedYear = yearFilter.value;
    const selectedMonth = monthFilter.value;
    const selectedSalesperson = salespersonFilter.value;

    filteredData = salesData.filter(item => {
        return (selectedYear === 'all' || item['Sales year'] === selectedYear) &&
            (selectedMonth === 'all' || item['Month'] === parseInt(selectedMonth)) &&
            (selectedSalesperson === 'all' || item['Sales person name'] === selectedSalesperson);
    });

    updateSummary();
    updateCharts();
    updatePerformanceTables();
}

function updateSummary() {
    const totalSales = filteredData.reduce((sum, item) => sum + item['Sales amount'], 0);
    const avgSales = filteredData.length > 0 ? totalSales / filteredData.length : 0;
    const topPerformer = getTopPerformer(filteredData);

    totalSalesElement.textContent = formatCurrency(totalSales);
    avgSalesElement.textContent = formatCurrency(avgSales);
    transactionCountElement.textContent = filteredData.length.toLocaleString();
    topPerformerElement.textContent = topPerformer ? `${topPerformer.name} (${formatCurrency(topPerformer.amount)})` : '-';
}

function getTopPerformer(data) {
    if (data.length === 0) return null;

    const salesByPerson = {};
    data.forEach(item => {
        const name = item['Sales person name'];
        salesByPerson[name] = (salesByPerson[name] || 0) + item['Sales amount'];
    });

    let topName = '';
    let topAmount = 0;

    for (const [name, amount] of Object.entries(salesByPerson)) {
        if (amount > topAmount) {
            topAmount = amount;
            topName = name;
        }
    }

    return { name: topName, amount: topAmount };
}

function updateMonthlySalesBySalespersonTable() {
    const tableBody = document.querySelector('#monthlySalesPersonTable tbody');
    tableBody.innerHTML = '';

    const salesMap = {}; // { "John Doe": { 1: 5000, 2: 6000, ... } }

    filteredData.forEach(item => {
        const name = item['Sales person name'];
        const month = item['Month'];
        const amount = item['Sales amount'];

        if (!salesMap[name]) {
            salesMap[name] = Array(12).fill(0); // 12 months
        }
        salesMap[name][month - 1] += amount;
    });

    const sortedNames = Object.keys(salesMap).sort();

    sortedNames.forEach(name => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = name;
        row.appendChild(nameCell);

        salesMap[name].forEach(total => {
            const cell = document.createElement('td');
            cell.textContent = total > 0 ? formatCurrency(total) : '-';
            row.appendChild(cell);
        });

        tableBody.appendChild(row);
    });
}



function updateCharts() {
    updateYearlySalesChart();
    updateMonthlySalesChart();
}

function updateYearlySalesChart() {
    const yearlyData = {};
    const years = [...new Set(filteredData.map(item => item['Sales year']))].sort();
    const salespeople = [...new Set(filteredData.map(item => item['Sales person name']))].sort();

    salespeople.forEach(person => {
        yearlyData[person] = {};
        years.forEach(year => {
            yearlyData[person][year] = 0;
        });
    });

    filteredData.forEach(item => {
        const name = item['Sales person name'];
        const year = item['Sales year'];
        yearlyData[name][year] += item['Sales amount'];
    });

    const datasets = salespeople.map((person, index) => {
        const colors = ['rgba(54, 162, 235, 0.7)', 'rgba(255, 99, 132, 0.7)', 'rgba(75, 192, 192, 0.7)', 'rgba(255, 159, 64, 0.7)', 'rgba(153, 102, 255, 0.7)'];
        return {
            label: person,
            data: years.map(year => yearlyData[person][year]),
            backgroundColor: colors[index % colors.length],
            borderColor: colors[index % colors.length].replace('0.7', '1'),
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const ctx = document.getElementById('yearlySalesChart').getContext('2d');

    if (yearlySalesChart) {
        yearlySalesChart.data.labels = years;
        yearlySalesChart.data.datasets = datasets;
        yearlySalesChart.update();
    } else {
        yearlySalesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: years,
                datasets: datasets
            },
            options: {
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: context => `${context.dataset.label}: ${formatCurrency(context.raw)}`
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: value => formatCurrency(value)
                        }
                    }
                }
            }
        });
    }
}

function updateMonthlySalesChart() {
    const monthlyData = {};
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    months.forEach(month => {
        monthlyData[month] = 0;
    });

    filteredData.forEach(item => {
        const month = item['Month'];
        monthlyData[month] += item['Sales amount'];
    });

    const ctx = document.getElementById('monthlySalesChart').getContext('2d');
    const monthNames = months.map(month => MONTH_NAMES[month - 1]);
    const amounts = months.map(month => monthlyData[month]);

    if (monthlySalesChart) {
        monthlySalesChart.data.labels = monthNames;
        monthlySalesChart.data.datasets[0].data = amounts;
        monthlySalesChart.update();
    } else {
        monthlySalesChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: monthNames,
                datasets: [{
                    label: 'Monthly Sales',
                    data: amounts,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: context => `Sales: ${formatCurrency(context.raw)}`
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: value => formatCurrency(value)
                        }
                    }
                }
            }
        });
    }
}

function updatePerformanceTables() {
    updateTopPerformersTable();
    updateSalesTeamTable();
    updateMonthlySalesBySalespersonTable();
}

function updateTopPerformersTable() {
    const months = [...new Set(filteredData.map(item => item['Month']))].sort();
    const monthlyTotals = {};
    const topPerformers = [];

    filteredData.forEach(item => {
        const month = item['Month'];
        monthlyTotals[month] = (monthlyTotals[month] || 0) + item['Sales amount'];
    });

    months.forEach(month => {
        const monthData = filteredData.filter(item => item['Month'] === month);
        const salesByPerson = {};

        monthData.forEach(item => {
            const name = item['Sales person name'];
            salesByPerson[name] = (salesByPerson[name] || 0) + item['Sales amount'];
        });

        let topName = '';
        let topAmount = 0;

        for (const [name, amount] of Object.entries(salesByPerson)) {
            if (amount > topAmount) {
                topAmount = amount;
                topName = name;
            }
        }

        const monthTotal = monthlyTotals[month];
        const percentage = monthTotal > 0 ? (topAmount / monthTotal * 100) : 0;

        topPerformers.push({
            month: MONTH_NAMES[month - 1],
            name: topName,
            amount: topAmount,
            percentage: percentage
        });
    });

    topPerformersTable.innerHTML = '';
    topPerformers.forEach(performer => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${performer.month}</td>
            <td>${performer.name || '-'}</td>
            <td>${formatCurrency(performer.amount)}</td>
            <td>${performer.percentage.toFixed(1)}%</td>
        `;
        topPerformersTable.appendChild(row);
    });
}

function updateSalesTeamTable() {
    const salesByPerson = {};
    const transactionCounts = {};

    filteredData.forEach(item => {
        const name = item['Sales person name'];
        salesByPerson[name] = (salesByPerson[name] || 0) + item['Sales amount'];
        transactionCounts[name] = (transactionCounts[name] || 0) + 1;
    });

    const teamPerformance = Object.entries(salesByPerson).map(([name, amount]) => {
        return {
            name: name,
            total: amount,
            average: amount / transactionCounts[name],
            transactions: transactionCounts[name]
        };
    }).sort((a, b) => b.total - a.total);

    salesTeamTable.innerHTML = '';
    teamPerformance.forEach(member => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${member.name}</td>
            <td>${formatCurrency(member.total)}</td>
            <td>${formatCurrency(member.average)}</td>
            <td>${member.transactions}</td>
        `;
        salesTeamTable.appendChild(row);
    });
}
