"""Convert the challenge CSVs into harbor/data.js (synthetic data only)."""
import csv, json, datetime as D, collections, os
root = os.path.join(os.path.dirname(__file__), '..', 'data')
def ms(s): return int(D.datetime.strptime(s, '%m/%d/%Y %H:%M').replace(tzinfo=D.timezone.utc).timestamp() * 1000)
def num(s):
    try: return float(s)
    except ValueError: return None
members = []
for r in csv.DictReader(open(f'{root}/HuskyHack_Member_Key_v2.csv')):
    members.append({
        'id': r['synthetic_member_id'], 'persona': r['anchor_persona'], 'scenario': r['scenario_type'],
        'subtype': r['scenario_subtype'], 'lookalike': r['is_legitimate_lookalike'] == 'Yes',
        'summary': r['journey_summary'], 'outcome': r['journey_outcome'],
        'scamPayments': [p for p in r['scam_payment_ids'].split(';') if p],
        'attempted': num(r['dollars_attempted']) or 0, 'sent': num(r['dollars_sent']) or 0,
        'prevented': num(r['dollars_prevented']) or 0, 'recovered': num(r['dollars_recovered']) or 0,
        'loss': num(r['net_member_loss']) or 0,
    })
events = collections.defaultdict(list)
for e in csv.DictReader(open(f'{root}/HuskyHack_Synthetic_Events_v2.csv')):
    events[e['synthetic_member_id']].append({
        'id': e['event_id'], 't': ms(e['event_timestamp']), 'type': e['event_type'], 'cat': e['event_category'],
        'ch': e['channel'], 'pid': e['payment_id'], 'rail': e['payment_rail'], 'amt': num(e['amount']) or 0,
        'dir': e['transaction_direction'], 'rid': e['recipient_id'], 'rs': e['recipient_status'],
        'rage': num(e['recipient_age_days']), 'ratio': num(e['amount_to_baseline_ratio']),
        'vs': e['amount_vs_member_baseline'], 'vel': e['payment_velocity_band'],
        'bal': num(e['available_balance_after']), 'pr': e['profile_change_recent'] == 'Yes',
        'rr': e['password_reset_recent'] == 'Yes', 'tc': e['trusted_contact_enrolled'] == 'Yes',
        'resp': e['member_response'], 'pst': e['payment_status'], 'note': e['event_note'],
    })
for v in events.values(): v.sort(key=lambda x: x['t'])
open(os.path.join(os.path.dirname(__file__), 'data.js'), 'w').write(
    'window.HARBOR_DATA=' + json.dumps({'members': members, 'events': events}, separators=(',', ':')) + ';')
print(len(members), 'members', sum(len(v) for v in events.values()), 'events')
