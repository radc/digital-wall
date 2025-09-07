export function isNowInSchedule(schedule) {
    if (!schedule) return true;
    try {
      const days = schedule.days || ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const start = schedule.start || "00:00";
      const end = schedule.end || "23:59";
  
      const now = new Date(); // fuso do dispositivo
      const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const day = dayMap[now.getDay()];
      if (!days.includes(day)) return false;
  
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
  
      if (endMin >= startMin) {
        return nowMin >= startMin && nowMin <= endMin;
      } else {
        return nowMin >= startMin || nowMin <= endMin; // atravessa meia-noite
      }
    } catch (e) {
      console.error("Erro ao validar schedule", e);
      return true;
    }
  }
  