// Audit trails: admin actions, user activity (action names only, never resume
// contents) and system errors.

export function logAdmin(db, { actorId, action, targetType = '', targetId = '', details = {}, ip = null }) {
  db.prepare('INSERT INTO admin_activity (actor_id, action, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorId ?? null, action, targetType, String(targetId ?? ''), JSON.stringify(details), ip);
}

export function logUser(db, { userId, action, details = {}, ip = null }) {
  db.prepare('INSERT INTO user_activity (user_id, action, details, ip) VALUES (?, ?, ?, ?)')
    .run(userId ?? null, action, JSON.stringify(details), ip);
}

export function logSystemError(db, context, err) {
  try {
    db.prepare('INSERT INTO system_errors (context, message, stack) VALUES (?, ?, ?)')
      .run(context, String(err?.message || err).slice(0, 2000), String(err?.stack || '').slice(0, 8000));
  } catch {
    // never let error logging throw
  }
}
