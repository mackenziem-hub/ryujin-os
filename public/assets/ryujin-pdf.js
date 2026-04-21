// Ryujin OS — PDF generator (lazy-loaded jsPDF)
// Usage: RyujinPDF.workOrder(wo), RyujinPDF.paySheet(ps), RyujinPDF.ticket(t)
// Loads jsPDF from CDN on first use, then generates and triggers download.

(function(){
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  let _loaded = null;

  function loadJsPDF(){
    if (_loaded) return _loaded;
    _loaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.onload = () => resolve(window.jspdf);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return _loaded;
  }

  function money(n){ if (n == null) return '—'; return '$' + Number(n).toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function safe(s){ return String(s == null ? '' : s); }

  // ─── Shared PDF setup ───────────────────────────────────────
  function newDoc(){
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: 'pt', format: 'letter' });
  }

  function header(doc, title, subtitle){
    doc.setFillColor(3, 6, 17);
    doc.rect(0, 0, 612, 70, 'F');
    // Accent bar
    doc.setFillColor(251, 146, 60);
    doc.rect(0, 68, 612, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('PLUS ULTRA ROOFING', 40, 32);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 220, 255);
    doc.text('2-6 McDowell Ave · Riverview NB · (506) 540-1052 · plusultraroofing@gmail.com', 40, 48);

    doc.setTextColor(251, 146, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text((title || '').toUpperCase(), 612 - 40, 32, { align: 'right' });
    if (subtitle){
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(150, 180, 210);
      doc.text(subtitle, 612 - 40, 48, { align: 'right' });
    }
    doc.setTextColor(0, 0, 0);
  }

  function footer(doc, refId){
    const page = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(120, 140, 160);
    doc.text(`Generated ${new Date().toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})} · Ryujin OS${refId ? ' · ' + refId : ''}`, 40, 770);
    doc.text('Page ' + page, 612 - 40, 770, { align: 'right' });
  }

  function sectionTitle(doc, y, text){
    doc.setFillColor(251, 146, 60);
    doc.rect(40, y - 2, 3, 12, 'F');
    doc.setTextColor(50, 60, 80);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(text.toUpperCase(), 50, y + 7);
    doc.setDrawColor(220, 225, 235);
    doc.line(40, y + 14, 572, y + 14);
    return y + 24;
  }

  function row(doc, y, label, value){
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(80, 90, 110);
    doc.text(label, 50, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(20, 25, 35);
    const wrapped = doc.splitTextToSize(safe(value), 360);
    doc.text(wrapped, 210, y);
    return y + 14 + (wrapped.length - 1) * 12;
  }

  function saveWith(doc, filename){
    doc.save(filename);
  }

  // ─── PAY SHEET ──────────────────────────────────────────────
  async function paySheet(ps){
    await loadJsPDF();
    const doc = newDoc();
    header(doc, 'Subcontractor Pay Sheet', safe(ps.job_id));
    let y = 90;

    y = sectionTitle(doc, y, 'Job');
    y = row(doc, y, 'Job / Address', ps.address);
    y = row(doc, y, 'Customer', ps.customer_name);
    y = row(doc, y, 'Subcontractor', ps.subcontractor);
    y = row(doc, y, 'Status', (ps.status || 'scheduled').replace('_',' ').toUpperCase());
    if (ps.shingle_product) y = row(doc, y, 'Shingle Product', ps.shingle_product);
    if (ps.eagleview_report) y = row(doc, y, 'EagleView', ps.eagleview_report);
    if (ps.scheduled_date) y = row(doc, y, 'Scheduled', ps.scheduled_date);

    y += 8;

    const drawTable = (title, items, hasQtyRate) => {
      if (!items || !items.length) return;
      y = sectionTitle(doc, y, title);
      // Table headers
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(100,110,130);
      doc.text('DESCRIPTION', 50, y);
      if (hasQtyRate) {
        doc.text('QTY', 380, y, {align:'right'});
        doc.text('RATE', 450, y, {align:'right'});
      }
      doc.text('TOTAL', 562, y, {align:'right'});
      y += 6;
      doc.setDrawColor(220,225,235); doc.line(50, y, 562, y);
      y += 12;
      // Rows
      items.forEach(it => {
        doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(20,25,35);
        const descLines = doc.splitTextToSize(safe(it.description), 310);
        doc.text(descLines, 50, y);
        if (hasQtyRate) {
          const qtyStr = it.qty_sq != null ? it.qty_sq + ' SQ' : (it.qty || '—');
          doc.text(safe(qtyStr), 380, y, {align:'right'});
          doc.text(safe(it.rate_per_sq || it.rate || '—'), 450, y, {align:'right'});
        }
        doc.setFont('helvetica','bold');
        doc.text(money(it.total), 562, y, {align:'right'});
        y += 14 + (descLines.length - 1) * 12;
      });
      y += 6;
    };

    drawTable('Labour Breakdown', ps.labour_breakdown, true);
    drawTable('Add-Ons', ps.add_ons, true);
    drawTable('Surcharges', ps.surcharges, true);

    // Totals
    y = sectionTitle(doc, y, 'Totals');
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(20,25,35);
    doc.text('Subtotal', 420, y); doc.text(money(ps.subtotal), 562, y, {align:'right'}); y += 16;
    doc.text('HST (15%)', 420, y); doc.text(money(ps.hst), 562, y, {align:'right'}); y += 16;
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.setTextColor(251, 146, 60);
    doc.text('Total Due', 420, y); doc.text(money(ps.total), 562, y, {align:'right'}); y += 20;
    doc.setTextColor(20,25,35);

    // Payments
    if (ps.payment_tracker && ps.payment_tracker.length) {
      y = sectionTitle(doc, y, 'Payments');
      ps.payment_tracker.forEach(p => {
        doc.setFont('helvetica','normal'); doc.setFontSize(10);
        doc.text(safe(p.method || p.date || 'Payment'), 50, y);
        doc.setTextColor(74, 180, 100);
        doc.text('-' + money(p.amount), 562, y, {align:'right'});
        doc.setTextColor(20,25,35);
        y += 14;
      });
      y += 4;
      doc.setFont('helvetica','bold');
      doc.text('Paid to Date', 420, y); doc.text(money(ps.paid_to_date), 562, y, {align:'right'}); y += 16;
      doc.setTextColor(250, 160, 30);
      doc.text('Balance Due', 420, y); doc.text(money(ps.balance_due), 562, y, {align:'right'}); y += 16;
      doc.setTextColor(20,25,35);
    }

    // Scope notes
    if (ps.scope_notes && ps.scope_notes.length) {
      y += 4;
      y = sectionTitle(doc, y, 'Scope Notes');
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,70,90);
      ps.scope_notes.forEach(n => {
        const wrapped = doc.splitTextToSize('· ' + safe(n), 512);
        doc.text(wrapped, 50, y);
        y += 12 + (wrapped.length - 1) * 10;
      });
    }

    footer(doc, ps.job_id);
    saveWith(doc, `PaySheet_${ps.job_id || 'sheet'}.pdf`);
  }

  // ─── WORK ORDER ─────────────────────────────────────────────
  async function workOrder(wo){
    await loadJsPDF();
    const doc = newDoc();
    header(doc, 'Work Order', 'WO-' + (wo.wo_number || '—'));
    let y = 90;

    y = sectionTitle(doc, y, 'Client');
    y = row(doc, y, 'Customer', wo.customer_name);
    y = row(doc, y, 'Address', wo.address);
    if (wo.phone) y = row(doc, y, 'Phone', wo.phone);
    if (wo.email) y = row(doc, y, 'Email', wo.email);

    y += 6;
    y = sectionTitle(doc, y, 'Schedule');
    y = row(doc, y, 'Start Date', wo.start_date || 'TBD');
    if (wo.estimated_duration_days) y = row(doc, y, 'Duration', wo.estimated_duration_days + ' days');
    y = row(doc, y, 'Status', (wo.status || 'draft').replace('_',' ').toUpperCase());
    if (wo.sub_crew_lead) y = row(doc, y, 'Crew Lead', wo.sub_crew_lead);

    y += 6;
    y = sectionTitle(doc, y, 'Scope');
    y = row(doc, y, 'Job Type', (wo.job_type || 'full_replacement').replace('_',' '));
    y = row(doc, y, 'Total Squares', (wo.total_sq || '—') + ' SQ');
    y = row(doc, y, 'Pitch', wo.roof_pitch || '—');
    y = row(doc, y, 'Shingle', (wo.shingle_product || '—') + (wo.shingle_color ? ' · ' + wo.shingle_color : ''));
    y = row(doc, y, 'Tier', (wo.package_tier || '—').toUpperCase());
    if (wo.layers_to_remove != null) y = row(doc, y, 'Layers Removing', wo.layers_to_remove);

    // Scope checklist
    if (wo.scope_items && wo.scope_items.length) {
      y += 8;
      y = sectionTitle(doc, y, 'Scope Checklist');
      doc.setFont('helvetica','normal'); doc.setFontSize(10);
      wo.scope_items.forEach(s => {
        if (y > 730) { doc.addPage(); y = 60; }
        doc.setDrawColor(180, 190, 210);
        doc.rect(50, y - 9, 10, 10);
        if (s.included) {
          doc.setDrawColor(74, 180, 100);
          doc.setLineWidth(1.5);
          doc.line(52, y - 5, 55, y - 2);
          doc.line(55, y - 2, 59, y - 8);
          doc.setLineWidth(0.5);
        }
        doc.setTextColor(s.included ? 20 : 120, s.included ? 25 : 140, s.included ? 35 : 160);
        let label = safe(s.item);
        if (s.qty) label += ' (' + s.qty + ')';
        doc.text(label, 68, y);
        y += 16;
      });
    }

    if (wo.special_notes) {
      y += 4;
      y = sectionTitle(doc, y, 'Special Notes');
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(60,70,90);
      const wrapped = doc.splitTextToSize(safe(wo.special_notes), 512);
      doc.text(wrapped, 50, y);
      y += 12 + (wrapped.length - 1) * 12;
    }

    if (wo.notes) {
      y += 4;
      y = sectionTitle(doc, y, 'Notes');
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,90,110);
      const wrapped = doc.splitTextToSize(safe(wo.notes), 512);
      doc.text(wrapped, 50, y);
    }

    footer(doc, 'WO-' + wo.wo_number);
    saveWith(doc, `WorkOrder_WO-${wo.wo_number || 'new'}_${(wo.customer_name || 'job').split(' ')[0]}.pdf`);
  }

  // ─── TICKET ─────────────────────────────────────────────────
  async function ticket(t){
    await loadJsPDF();
    const doc = newDoc();
    header(doc, 'Task / Ticket', '#' + (t.id || t.ticket_number || ''));
    let y = 90;

    y = sectionTitle(doc, y, 'Task');
    y = row(doc, y, 'Title', t.title);
    if (t.priority) y = row(doc, y, 'Priority', String(t.priority).replace('_',' ').toUpperCase());
    if (t.status) y = row(doc, y, 'Status', String(t.status).toUpperCase());
    if (t.due_date) y = row(doc, y, 'Due Date', t.due_date);
    if (t.assignee || t.assigned_to_name) y = row(doc, y, 'Assigned To', t.assignee || t.assigned_to_name);

    if (t.description) {
      y += 6;
      y = sectionTitle(doc, y, 'Description');
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(30,40,60);
      const wrapped = doc.splitTextToSize(safe(t.description), 512);
      doc.text(wrapped, 50, y);
    }

    footer(doc, '#' + (t.id || ''));
    saveWith(doc, `Ticket_${(t.id || t.ticket_number || 'task')}_${(t.title || '').slice(0,20).replace(/[^a-z0-9]/gi,'_')}.pdf`);
  }

  window.RyujinPDF = { paySheet, workOrder, ticket };
})();
