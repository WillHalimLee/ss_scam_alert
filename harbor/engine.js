/* Harbor trigger engine: event-based, two stages: flag the account, then check each payment. Runs in browser and node. */
(function (root) {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const DEFAULTS = {
    atoWindowMin: 90,        // reset -> payment window for the fast-change pattern
    highStakesRatio: 1.5,    // x member baseline (Above Typical or more)
    freshRecipientRatio: 1.5,
    realMoverGapHours: 12,   // address-only change + gap longer than this = look-alike suppression
    rampMinPriorP2P: 2,      // payments to a young recipient before escalation
    youngRecipientDays: 30,
  };

  function isOutgoingPayment(e) {
    return e.type === 'Payment Initiated' && e.dir === 'Outgoing';
  }

  function createState() {
    return { reset: null, email: null, phone: null, address: null, youngP2P: 0, lastContact: null, armedAt: null };
  }

  /** Advance one member's state by one event. Returns a decision for outgoing payments, otherwise null.
   *  State is plain JSON, so a streaming service can persist it between events. */
  function step(st, e, cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg || {});
    switch (e.type) {
      case 'Password Reset': st.reset = e.t; break;
      case 'Email Change': st.email = e.t; break;
      case 'Phone Change': st.phone = e.t; break;
      case 'Address Change': st.address = e.t; break;
      case 'Branch Visit': case 'Contact Center Call': st.lastContact = e.t; break;
    }
    // Stage 1: flag the account as at risk (silent; internally "armed"). Reset + a contact-detail change inside 24h.
    if (st.armedAt === null && st.reset !== null && (st.email !== null || st.phone !== null) &&
        Math.abs((st.email ?? st.phone) - st.reset) < DAY) {
      st.armedAt = e.t;
    }
    if (!isOutgoingPayment(e)) return null;

    // Stage 2: check the payment, evaluated at Payment Initiated.
    const rules = [];
    let level = 'none';
    const bump = (l) => { if (l === 'hold' || level === 'none') level = l; };
    const newRecip = e.rs === 'New';
    const wireish = e.rail === 'Wire' || e.rail === 'External Transfer';

    // R1 ATO Fast-Change
    const contactChanged = st.email !== null && st.phone !== null;
    if (st.reset !== null && contactChanged && newRecip && e.t - st.reset <= cfg.atoWindowMin * MIN) {
      rules.push({ id: 'ATO', label: 'Account takeover pattern',
        reason: 'Password reset, then email and phone changed, then a brand-new recipient, all within ' + Math.round((e.t - st.reset) / MIN) + ' minutes.' });
      bump('hold');
    }
    // Look-alike: address-only change with a long gap is a real move, not a takeover.
    const addressOnly = st.reset !== null && st.address !== null && !contactChanged;
    const realMover = addressOnly && e.t - st.reset > cfg.realMoverGapHours * HOUR;

    // R2 Slow-burn ramp: young-recipient P2P history, now escalating to wire / external transfer to a new recipient
    if (e.rail === 'P2P' && newRecip) st.youngP2P++;
    else if (e.rail === 'P2P' && e.rage !== null && e.rage <= cfg.youngRecipientDays) st.youngP2P++;
    if (wireish && newRecip && st.youngP2P >= cfg.rampMinPriorP2P) {
      rules.push({ id: 'RAMP', label: 'Escalating payments to a new contact',
        reason: st.youngP2P + ' recent payments to people who are new to this account, now a ' + e.rail.toLowerCase() + ' to another new recipient.' });
      bump('hold');
    }

    // R3 High-stakes rail
    const bigVsBaseline = e.vs === 'Significantly Above Typical' || (e.ratio !== null && e.ratio >= cfg.highStakesRatio);
    const plan = (cfg.planned || []).find((p) => p.rail === e.rail && Math.abs(e.amt - p.amount) <= p.amount * 0.1);
    if ((e.rail === 'Wire' || e.rail === 'Cash') && (newRecip || e.rail === 'Cash') && bigVsBaseline) {
      rules.push({ id: 'HIGHSTAKES', label: 'Large ' + e.rail.toLowerCase() + ' payment, hard to reverse',
        reason: '$' + Math.round(e.amt).toLocaleString() + ' by ' + e.rail.toLowerCase() + ' is far above this member\'s usual activity' + (newRecip ? ' and goes to a new recipient.' : '.') });
      bump('hold');
    }

    // R4 Fresh-recipient urgency
    if (e.rail === 'P2P' && newRecip && e.ratio !== null && e.ratio >= cfg.freshRecipientRatio) {
      rules.push({ id: 'FRESH', label: 'Larger-than-usual payment to a new person',
        reason: 'First payment to a new recipient, ' + e.ratio.toFixed(1) + 'x this member\'s usual amount.' });
      bump('confirm');
    }

    // R5 Contact-then-pay
    if (st.lastContact !== null && e.t - st.lastContact <= 90 * MIN && bigVsBaseline && e.rail !== 'P2P') {
      rules.push({ id: 'CONTACT', label: 'Large payment right after contacting Sound',
        reason: 'Large payment started within ' + Math.round((e.t - st.lastContact) / MIN) + ' minutes of a branch visit or call.' });
      bump('hold');
    }

    // Per-rule check trace, so the UI can show exactly what defines (and what failed) a trigger.
    const ago = (t) => (t === null ? 'never' : Math.round((e.t - t) / MIN) + ' min ago');
    const ratioTxt = e.ratio === null ? 'n/a' : e.ratio.toFixed(2) + 'x baseline';
    const trace = [
      { id: 'ATO', fired: rules.some((r) => r.id === 'ATO'), checks: [
        { label: 'Password reset within ' + cfg.atoWindowMin + ' min of this payment', pass: st.reset !== null && e.t - st.reset <= cfg.atoWindowMin * MIN, value: ago(st.reset) },
        { label: 'Email AND phone both changed', pass: contactChanged, value: 'email ' + (st.email !== null ? 'yes' : 'no') + ', phone ' + (st.phone !== null ? 'yes' : 'no') },
        { label: 'Recipient is new (30 days or less)', pass: newRecip, value: e.rs }] },
      { id: 'RAMP', fired: rules.some((r) => r.id === 'RAMP'), checks: [
        { label: 'Wire or external transfer', pass: wireish, value: e.rail },
        { label: 'Recipient is new', pass: newRecip, value: e.rs },
        { label: 'At least ' + cfg.rampMinPriorP2P + ' earlier P2P payments to new/young recipients', pass: st.youngP2P >= cfg.rampMinPriorP2P, value: st.youngP2P + ' so far' }] },
      { id: 'HIGHSTAKES', fired: rules.some((r) => r.id === 'HIGHSTAKES'), checks: [
        { label: 'Wire or cash (hard to reverse)', pass: e.rail === 'Wire' || e.rail === 'Cash', value: e.rail },
        { label: 'New recipient (or cash)', pass: newRecip || e.rail === 'Cash', value: e.rail === 'Cash' ? 'cash' : e.rs },
        { label: 'At least ' + cfg.highStakesRatio + 'x the member\'s usual amount', pass: bigVsBaseline, value: ratioTxt }] },
      { id: 'FRESH', fired: rules.some((r) => r.id === 'FRESH'), checks: [
        { label: 'P2P payment', pass: e.rail === 'P2P', value: e.rail },
        { label: 'New recipient', pass: newRecip, value: e.rs },
        { label: 'At least ' + cfg.freshRecipientRatio + 'x the member\'s usual amount', pass: e.ratio !== null && e.ratio >= cfg.freshRecipientRatio, value: ratioTxt }] },
      { id: 'CONTACT', fired: rules.some((r) => r.id === 'CONTACT'), checks: [
        { label: 'Branch visit or call within 90 min', pass: st.lastContact !== null && e.t - st.lastContact <= 90 * MIN, value: ago(st.lastContact) },
        { label: 'Large vs the member\'s usual amount', pass: bigVsBaseline, value: ratioTxt },
        { label: 'Not a P2P payment', pass: e.rail !== 'P2P', value: e.rail }] },
    ];
    // Look-alike suppression: drop to light confirmation when the context is explainable.
    const suppress = [];
    if (rules.length && realMover) suppress.push('Address-only change and the payment came about ' + Math.round((e.t - st.reset) / HOUR) + 'h after the reset: looks like a real move.');
    if (rules.length && plan && !rules.some((r) => r.id === 'ATO')) suppress.push('Matches the Planned Big Payment declared in advance: ' + plan.label + '.');
    if (suppress.length && level === 'hold' && (realMover || !rules.some((r) => r.id === 'ATO'))) level = 'confirm';
    // ATO signature is never suppressed by a declared plan.
    return ({ eventId: e.id, pid: e.pid, t: e.t, rail: e.rail, amt: e.amt, rid: e.rid, rs: e.rs, ratio: e.ratio, ch: e.ch, level, rules, suppress, trace, armed: st.armedAt !== null, armedAt: st.armedAt, resetAt: st.reset, realMover });
  }

  /** Walk one member's events; return decisions made at each Payment Initiated. */
  function evaluate(events, cfg) {
    const st = createState(), out = [];
    for (const e of events) { const d = step(st, e, cfg); if (d) out.push(d); }
    return out;
  }

  /** Score the engine over all members: caught scams, false positives, misses. */
  function scoreAll(data, cfg) {
    const rows = [];
    for (const m of data.members) {
      const decisions = evaluate(data.events[m.id], Object.assign({}, cfg, { planned: ((cfg || {}).plannedByMember || {})[m.id] })).filter((d) => d.level !== 'none');
      const holds = decisions.filter((d) => d.level === 'hold');
      const confirms = decisions.filter((d) => d.level === 'confirm');
      const isScam = m.scenario !== 'Normal Activity';
      const first = holds[0] || null;
      let prevented = 0, sentAfter = 0;
      if (isScam) {
        const evs = data.events[m.id];
        const scamPay = evs.filter((e) => e.type === 'Payment Initiated' && m.scamPayments.includes(e.pid));
        const flagged = first ? first.t : Infinity;
        for (const p of scamPay) { if (p.t >= flagged) prevented += p.amt; else sentAfter += p.amt; }
      }
      rows.push({ id: m.id, scenario: m.scenario, subtype: m.subtype, lookalike: m.lookalike, isScam,
        caught: isScam && holds.length > 0, hold: !isScam && holds.length > 0, confirm: !isScam && confirms.length > 0 && holds.length === 0,
        holds, confirms, prevented, sentBeforeFlag: sentAfter, firstHold: first });
    }
    return rows;
  }

  const api = { evaluate, step, createState, scoreAll, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HarborEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
