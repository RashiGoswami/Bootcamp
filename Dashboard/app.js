(function(){
"use strict";
const DATA = window.DASHBOARD_DATA;
const fmtMoney = (n) => "$" + Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2, maximumFractionDigits:2});
const fmtMoneyShort = (n) => "$" + Number(n||0).toLocaleString("en-US",{maximumFractionDigits:0});
const fmtInt = (n) => Number(n||0).toLocaleString("en-US");
const fmtDate = (d) => { const dt = new Date(d+"T00:00:00"); return dt.toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"}); };
const initials = (name) => (name||"?").trim().split(/\s+/).map(s=>s[0]).join("").slice(0,2).toUpperCase();

// ---------------- Theme colors (kept in sync with CSS) ----------------
const COLORS = {orange:"#EA580C", amber:"#D97706", textMid:"#6B6459", textDim:"#A29B8C", grid:"rgba(107,100,89,0.08)"};

// ---------------- State ----------------
let state = {
  search:"", period:"all", product:"all", customer:"all",
  trendMode:"revenue",
  productsPage:1, productsPageSize:10, productsSort:{key:"revenue",dir:-1}, productsQuery:"",
  customersPage:1, customersPageSize:10, customersSort:{key:"revenue",dir:-1}, customersQuery:"",
  ordersPage:1, ordersPageSize:10, ordersSort:{key:"date",dir:-1},
};

let trendChart=null, simModeChart=null;

// ---------------- Populate filter dropdowns ----------------
function initFilters(){
  const prodSel = document.getElementById("filterProduct");
  DATA.all_products_ordered.forEach(p=>{
    const o = document.createElement("option");
    o.value = p.prod_id; o.textContent = p.name.length>46 ? p.name.slice(0,46)+"…" : p.name;
    prodSel.appendChild(o);
  });
  prodSel.querySelector("option[value='all']").textContent = `All Products (${DATA.all_products_ordered.length})`;

  const custSel = document.getElementById("filterCustomer");
  DATA.all_customers_ordered.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{
    const o = document.createElement("option");
    o.value = c.user_id; o.textContent = c.name;
    custSel.appendChild(o);
  });
  custSel.querySelector("option[value='all']").textContent = `All Customers (${DATA.all_customers_ordered.length})`;

  document.getElementById("globalSearch").addEventListener("input", e=>{ state.search = e.target.value.trim().toLowerCase(); state.ordersPage=1; recompute(); });
  document.getElementById("filterPeriod").addEventListener("change", e=>{ state.period = e.target.value; recompute(); });
  document.getElementById("filterProduct").addEventListener("change", e=>{ state.product = e.target.value; recompute(); });
  document.getElementById("filterCustomer").addEventListener("change", e=>{ state.customer = e.target.value; recompute(); });
}

// ---------------- Filtering ----------------
function getFilteredOrders(){
  const s = state.search;
  return DATA.orders_ledger.filter(o=>{
    if(state.period!=="all" && !o.date.startsWith(state.period)) return false;
    if(state.product!=="all" && o.product_id!==state.product) return false;
    if(state.customer!=="all" && o.user_id!==state.customer) return false;
    if(s){
      const hay = (o.order_no+" "+o.customer+" "+o.product).toLowerCase();
      if(!hay.includes(s)) return false;
    }
    return true;
  });
}

// ---------------- KPIs ----------------
function updateKPIs(orders){
  const revenue = orders.reduce((a,o)=>a+o.amount,0);
  const discount = orders.reduce((a,o)=>a+o.discount,0);
  const count = orders.length;
  const aov = count ? revenue/count : 0;
  document.getElementById("kpiRevenue").textContent = fmtMoney(revenue);
  document.getElementById("kpiOrders").textContent = fmtInt(count);
  document.getElementById("kpiAov").textContent = fmtMoney(aov);
  document.getElementById("kpiDiscount").textContent = fmtMoney(discount);
  document.getElementById("kpiRevenueOrders").textContent = "Live";

  const active = state.search || state.period!=="all" || state.product!=="all" || state.customer!=="all";
  document.getElementById("filterStatus").innerHTML = active
    ? `Showing ${fmtInt(count)} of ${DATA.orders_ledger.length} orders`
    : "<em>Filtering live metrics instantly</em>";
}

// ---------------- Trend chart ----------------
function groupTrend(orders){
  const map = {};
  orders.forEach(o=>{
    if(!map[o.date]) map[o.date]={date:o.date, revenue:0, orders:0};
    map[o.date].revenue += o.amount;
    map[o.date].orders += 1;
  });
  return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
}

function updateTrendChart(orders){
  const rows = groupTrend(orders);
  const labels = rows.map(r=>fmtDate(r.date));
  const revData = rows.map(r=>r.revenue);
  const ordData = rows.map(r=>r.orders);
  const ctx = document.getElementById("trendChart").getContext("2d");

  const mode = state.trendMode;
  const datasets = [];
  if(mode==="revenue" || mode==="combined"){
    datasets.push({
      label:"Revenue", data:revData, borderColor:COLORS.orange, backgroundColor:"rgba(234,88,12,0.10)",
      fill:true, tension:0.35, yAxisID:"y", pointRadius:0, pointHoverRadius:4, borderWidth:2,
    });
  }
  if(mode==="orders" || mode==="combined"){
    datasets.push({
      label:"Orders", data:ordData, borderColor:COLORS.amber, backgroundColor:"rgba(219,138,31,0.10)",
      fill: mode==="orders", tension:0.35, yAxisID: mode==="combined" ? "y1" : "y", pointRadius:0, pointHoverRadius:4, borderWidth:2,
    });
  }

  const scales = {
    x:{ grid:{color:COLORS.grid, display:false}, ticks:{color:COLORS.textDim, font:{family:"Inter", size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:8} },
    y:{ grid:{color:COLORS.grid}, ticks:{color:COLORS.textDim, font:{family:"Inter", size:10},
        callback:(v)=> mode==="orders" ? v : fmtMoneyShort(v) } },
  };
  if(mode==="combined"){
    scales.y1 = { position:"right", grid:{display:false}, ticks:{color:COLORS.amber, font:{family:"Inter", size:10}} };
  }

  if(trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type:"line",
    data:{labels, datasets},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:"index", intersect:false},
      plugins:{
        legend:{display: mode==="combined", labels:{color:COLORS.textMid, boxWidth:10, font:{size:11}}},
        tooltip:{
          backgroundColor:"#FFFFFF", borderColor:"#E7E9F2", borderWidth:1,
          titleColor:"#171923", bodyColor:"#5B6072", titleFont:{family:"Inter", size:11}, bodyFont:{family:"Inter", size:11},
          callbacks:{ label:(item)=>{
            if(item.dataset.label==="Revenue") return " Revenue: "+fmtMoney(item.parsed.y);
            return " Orders: "+fmtInt(item.parsed.y);
          }}
        }
      },
      scales
    }
  });
}

// ---------------- Top destinations ----------------
function groupDestinations(orders){
  const map = {};
  orders.forEach(o=>{
    const covs = o.coverage||[];
    if(!covs.length) return;
    const share = o.amount/covs.length;
    covs.forEach(c=>{
      if(!map[c]) map[c] = {code:c, revenue:0, orders:0};
      map[c].revenue += share;
      map[c].orders += 1;
    });
  });
  const nameMap = {};
  DATA.all_destinations_ordered.forEach(d=>{ nameMap[d.code]=d.name; });
  return Object.values(map).map(d=>({...d, name: nameMap[d.code]||d.code}))
    .sort((a,b)=>b.revenue-a.revenue).slice(0,6);
}

function updateBoard(orders){
  const rows = groupDestinations(orders);
  const el = document.getElementById("destList");
  el.innerHTML = "";
  if(!rows.length){
    el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No destinations match current filters</p>';
    return;
  }
  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className = "rank-item";
    div.innerHTML = `
      <div class="rank-avatar">${(r.name||"?").slice(0,2).toUpperCase()}</div>
      <div class="rank-info">
        <div class="rank-name">${r.name}</div>
        <div class="rank-sub">${r.orders} order${r.orders===1?"":"s"}</div>
      </div>
      <div class="rank-val">${fmtMoneyShort(r.revenue)}</div>
    `;
    el.appendChild(div);
  });
}

// ---------------- Top products bar list ----------------
function groupProducts(orders){
  const map = {};
  orders.forEach(o=>{
    if(!map[o.product_id]) map[o.product_id] = {name:o.product, revenue:0, orders:0};
    map[o.product_id].revenue += o.amount;
    map[o.product_id].orders += 1;
  });
  return Object.values(map).sort((a,b)=>b.revenue-a.revenue).slice(0,6);
}

function updateTopProducts(orders){
  const rows = groupProducts(orders);
  const el = document.getElementById("topProductsList");
  el.innerHTML = "";
  const max = rows.length ? rows[0].revenue : 1;
  if(!rows.length){ el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No products match current filters</p>'; return; }
  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className = "bar-item";
    div.innerHTML = `
      <div class="bar-item-top"><span class="name" title="${r.name}">${r.name}</span><span class="val">${fmtMoneyShort(r.revenue)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,(r.revenue/max*100))}%"></div></div>
    `;
    el.appendChild(div);
  });
}

// ---------------- SIM mode donut ----------------
function groupSimMode(orders){
  const map = {"eSIM":0, "Physical SIM":0};
  orders.forEach(o=>{
    const key = o.sim_mode==="eSIM" ? "eSIM" : (o.sim_mode==="Physical" ? "Physical SIM" : null);
    if(key) map[key]+=o.amount;
  });
  return map;
}

function updateSimModeChart(orders){
  const map = groupSimMode(orders);
  const ctx = document.getElementById("simModeChart").getContext("2d");
  const data = [map["eSIM"], map["Physical SIM"]];
  const total = data[0]+data[1] || 1;
  if(simModeChart) simModeChart.destroy();
  simModeChart = new Chart(ctx, {
    type:"doughnut",
    data:{ labels:["eSIM","Physical SIM"], datasets:[{ data, backgroundColor:[COLORS.orange, COLORS.amber], borderColor:"#FFFFFF", borderWidth:3, hoverOffset:6 }] },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:"68%",
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:"#FFFFFF", borderColor:"#E7E9F2", borderWidth:1,
          titleColor:"#171923", bodyColor:"#5B6072",
          callbacks:{ label:(item)=> " "+item.label+": "+fmtMoney(item.parsed)+" ("+Math.round(item.parsed/total*100)+"%)" }
        }
      }
    }
  });
  const legend = document.getElementById("simModeLegend");
  legend.innerHTML = `
    <span class="legend-item"><span class="legend-dot" style="background:${COLORS.orange}"></span>eSIM · ${Math.round(data[0]/total*100)}%</span>
    <span class="legend-item"><span class="legend-dot" style="background:${COLORS.amber}"></span>Physical · ${Math.round(data[1]/total*100)}%</span>
  `;
}

// ---------------- Top customers ----------------
function groupCustomers(orders){
  const map = {};
  orders.forEach(o=>{
    if(!map[o.user_id]) map[o.user_id] = {name:o.customer, revenue:0, orders:0};
    map[o.user_id].revenue += o.amount;
    map[o.user_id].orders += 1;
  });
  return Object.values(map).sort((a,b)=>b.revenue-a.revenue).slice(0,6);
}

function updateTopCustomers(orders){
  const rows = groupCustomers(orders);
  const el = document.getElementById("topCustomersList");
  el.innerHTML = "";
  if(!rows.length){ el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No customers match current filters</p>'; return; }
  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className = "rank-item";
    div.innerHTML = `
      <div class="rank-avatar">${initials(r.name)}</div>
      <div class="rank-info">
        <div class="rank-name">${r.name}</div>
        <div class="rank-sub">${r.orders} order${r.orders===1?"":"s"}</div>
      </div>
      <div class="rank-val">${fmtMoneyShort(r.revenue)}</div>
    `;
    el.appendChild(div);
  });
}

// ---------------- Staff performance ----------------
function groupStaff(orders){
  const map = {};
  orders.forEach(o=>{
    // orders_ledger doesn't carry created_by directly at row-level filter time; fall back to static list scaled proportionally when filters active
  });
  return null;
}

function updateStaff(){
  const el = document.getElementById("staffList");
  el.innerHTML = "";
  DATA.staff_performance.forEach(s=>{
    const div = document.createElement("div");
    div.className = "staff-card";
    div.innerHTML = `
      <div class="staff-name">${s.name}</div>
      <div class="staff-meta"><span class="m-orders">${s.orders} orders</span><span class="m-rev">${fmtMoneyShort(s.revenue)}</span></div>
    `;
    el.appendChild(div);
  });
}

// ---------------- Generic table renderer ----------------
function renderTable(opts){
  const {rows, columns, tbodyEl, page, pageSize, pagerEl, onPage} = opts;
  const start = (page-1)*pageSize;
  const pageRows = rows.slice(start, start+pageSize);
  tbodyEl.innerHTML = "";
  if(!pageRows.length){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${columns.length}" style="text-align:center;color:var(--text-dim);padding:26px;">No matching records</td>`;
    tbodyEl.appendChild(tr);
  }
  pageRows.forEach(row=>{
    const tr = document.createElement("tr");
    tr.innerHTML = columns.map(c=>c.render(row)).join("");
    tbodyEl.appendChild(tr);
  });
  const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
  pagerEl.innerHTML = `
    <span>Showing ${rows.length ? start+1 : 0}–${Math.min(start+pageSize, rows.length)} of ${fmtInt(rows.length)}</span>
    <div class="pager-btns">
      <button data-dir="first" ${page<=1?"disabled":""}>« First</button>
      <button data-dir="prev" ${page<=1?"disabled":""}>‹ Prev</button>
      <span style="align-self:center;font-family:'Inter';font-size:11px;padding:0 6px;">Page ${page} / ${totalPages}</span>
      <button data-dir="next" ${page>=totalPages?"disabled":""}>Next ›</button>
      <button data-dir="last" ${page>=totalPages?"disabled":""}>Last »</button>
    </div>
  `;
  pagerEl.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{
      let p = page;
      if(b.dataset.dir==="first") p=1;
      else if(b.dataset.dir==="prev") p=Math.max(1,page-1);
      else if(b.dataset.dir==="next") p=Math.min(totalPages,page+1);
      else if(b.dataset.dir==="last") p=totalPages;
      onPage(p);
    });
  });
}

function sortRows(rows, sort){
  const {key, dir} = sort;
  return rows.slice().sort((a,b)=>{
    let av=a[key], bv=b[key];
    if(typeof av==="string"){ av=av.toLowerCase(); bv=(bv||"").toLowerCase(); return dir*av.localeCompare(bv); }
    return dir*((av||0)-(bv||0));
  });
}

function wireSortableHeaders(tableId, sortState, renderFn){
  const table = document.getElementById(tableId);
  table.querySelectorAll("th[data-key]").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.key;
      if(sortState.key===key) sortState.dir *= -1; else { sortState.key=key; sortState.dir = (key==="revenue"||key==="orders"||key==="amount") ? -1 : 1; }
      table.querySelectorAll("th").forEach(h=>h.classList.remove("sorted"));
      th.classList.add("sorted");
      renderFn();
    });
  });
}

// ---------------- Products tab ----------------
function renderProductsTab(){
  let rows = DATA.products_catalog;
  if(state.productsQuery){
    const q = state.productsQuery;
    rows = rows.filter(p => p.name.toLowerCase().includes(q));
  }
  rows = sortRows(rows, state.productsSort);
  document.getElementById("productsSubhead").textContent = `${fmtInt(rows.length)} plans across eSIM & physical SIM`;
  renderTable({
    rows, pageSize: state.productsPageSize, page: state.productsPage,
    tbodyEl: document.querySelector("#productsTable tbody"),
    pagerEl: document.getElementById("productsPager"),
    onPage:(p)=>{ state.productsPage=p; renderProductsTab(); },
    columns:[
      {render:(r)=>`<td class="strong" title="${r.name}">${r.name.length>58?r.name.slice(0,58)+"…":r.name}</td>`},
      {render:(r)=>`<td><span class="pill ${r.sim_mode==="eSIM"?"pill-esim":"pill-physical"}">${r.sim_mode}</span></td>`},
      {render:(r)=>`<td class="num mono">${r.validity?r.validity+"d":"—"}</td>`},
      {render:(r)=>`<td class="num mono">${fmtMoney(r.amount)}</td>`},
      {render:(r)=>`<td class="num mono">${fmtInt(r.orders)}</td>`},
      {render:(r)=>`<td class="num mono" style="color:var(--orange)">${fmtMoney(r.revenue)}</td>`},
    ]
  });
}

// ---------------- Customers tab ----------------
function renderCustomersTab(){
  let rows = DATA.customers_catalog;
  if(state.customersQuery){
    const q = state.customersQuery;
    rows = rows.filter(c => c.name.toLowerCase().includes(q) || (c.mobile||"").includes(q));
  }
  rows = sortRows(rows, state.customersSort);
  document.getElementById("customersSubhead").textContent = `${fmtInt(rows.length)} registered travellers`;
  renderTable({
    rows, pageSize: state.customersPageSize, page: state.customersPage,
    tbodyEl: document.querySelector("#customersTable tbody"),
    pagerEl: document.getElementById("customersPager"),
    onPage:(p)=>{ state.customersPage=p; renderCustomersTab(); },
    columns:[
      {render:(r)=>`<td class="strong">${r.name}</td>`},
      {render:(r)=>`<td class="mono">+${r.country_code}</td>`},
      {render:(r)=>`<td class="mono">${r.joined||"—"}</td>`},
      {render:(r)=>`<td class="num mono">${fmtInt(r.orders)}</td>`},
      {render:(r)=>`<td class="num mono" style="color:var(--orange)">${fmtMoney(r.revenue)}</td>`},
    ]
  });
}

// ---------------- Orders tab ----------------
function renderOrdersTab(orders){
  let rows = sortRows(orders, state.ordersSort);
  document.getElementById("ordersSubhead").textContent = `${fmtInt(rows.length)} transactions`;
  renderTable({
    rows, pageSize: state.ordersPageSize, page: state.ordersPage,
    tbodyEl: document.querySelector("#ordersTable tbody"),
    pagerEl: document.getElementById("ordersPager"),
    onPage:(p)=>{ state.ordersPage=p; renderOrdersTab(getFilteredOrders()); },
    columns:[
      {render:(r)=>`<td class="mono strong">#${r.order_no}</td>`},
      {render:(r)=>`<td class="mono">${fmtDate(r.date)}</td>`},
      {render:(r)=>`<td class="strong">${r.customer}</td>`},
      {render:(r)=>`<td title="${r.product}">${r.product.length>42?r.product.slice(0,42)+"…":r.product}</td>`},
      {render:(r)=>`<td><span class="pill ${r.sim_mode==="eSIM"?"pill-esim":"pill-physical"}">${r.sim_mode}</span></td>`},
      {render:(r)=>`<td class="num mono">${fmtMoney(r.amount)}</td>`},
      {render:(r)=>`<td class="num mono" style="color:var(--amber)">${r.discount?fmtMoney(r.discount):"—"}</td>`},
      {render:(r)=>`<td class="num mono" style="color:var(--orange)">${fmtMoney(r.amount-r.discount)}</td>`},
    ]
  });
}

// ---------------- Master recompute ----------------
function recompute(){
  const orders = getFilteredOrders();
  updateKPIs(orders);
  updateTrendChart(orders);
  updateBoard(orders);
  updateTopProducts(orders);
  updateSimModeChart(orders);
  updateTopCustomers(orders);
  state.ordersPage = 1;
  renderOrdersTab(orders);
}

// ---------------- Tabs ----------------
function initTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    });
  });
}

function initTrendToggle(){
  document.querySelectorAll("#trendToggle .seg").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#trendToggle .seg").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      state.trendMode = btn.dataset.mode;
      updateTrendChart(getFilteredOrders());
    });
  });
}

function initTableSearches(){
  document.getElementById("productsSearch").addEventListener("input", e=>{
    state.productsQuery = e.target.value.trim().toLowerCase(); state.productsPage=1; renderProductsTab();
  });
  document.getElementById("customersSearch").addEventListener("input", e=>{
    state.customersQuery = e.target.value.trim().toLowerCase(); state.customersPage=1; renderCustomersTab();
  });
  wireSortableHeaders("productsTable", state.productsSort, renderProductsTab);
  wireSortableHeaders("customersTable", state.customersSort, renderCustomersTab);
  wireSortableHeaders("ordersTable", state.ordersSort, ()=>renderOrdersTab(getFilteredOrders()));
}

function initHeaderActions(){
  document.getElementById("refreshBtn").addEventListener("click", (e)=>{
    const btn = e.currentTarget;
    btn.classList.add("spinning");
    setTimeout(()=>{ btn.classList.remove("spinning"); setSyncTime(); recompute(); }, 550);
  });
  document.getElementById("exportBtn").addEventListener("click", ()=>{
    const orders = getFilteredOrders();
    const header = ["order_no","date","customer","product","sim_mode","amount","discount","net"];
    const lines = [header.join(",")];
    orders.forEach(o=>{
      const row = [o.order_no, o.date, `"${o.customer.replace(/"/g,'""')}"`, `"${o.product.replace(/"/g,'""')}"`, o.sim_mode, o.amount.toFixed(2), o.discount.toFixed(2), (o.amount-o.discount).toFixed(2)];
      lines.push(row.join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sales_analytics_orders_export.csv"; a.click();
    URL.revokeObjectURL(url);
  });
}

function setSyncTime(){
  const now = new Date();
  document.getElementById("updatedTime").textContent = now.toLocaleString("en-US",{month:"short",day:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

function initHeaderCounts(){
  document.getElementById("tabCountProducts").textContent = `(${DATA.kpis.total_products})`;
  document.getElementById("tabCountCustomers").textContent = `(${DATA.kpis.total_customers})`;
  document.getElementById("tabCountOrders").textContent = `(${DATA.kpis.total_orders})`;
  document.getElementById("footRange").textContent = `Manifest window: ${fmtDate(DATA.kpis.date_min)} — ${fmtDate(DATA.kpis.date_max)}`;
}

// ---------------- Init ----------------
document.addEventListener("DOMContentLoaded", ()=>{
  initFilters();
  initTabs();
  initTrendToggle();
  initTableSearches();
  initHeaderActions();
  initHeaderCounts();
  setSyncTime();
  updateStaff();
  renderProductsTab();
  renderCustomersTab();
  recompute();
});
})();
