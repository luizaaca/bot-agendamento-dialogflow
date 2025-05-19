const { google } = require('googleapis');
const { HORARIO_INICIO, HORARIO_FIM, SLOT_MINUTOS, INTERVALO_AGENDAMENTO, DIA_LIMITE, CALENDAR_ID } = require('./config');
const { DateTime } = require('luxon'); 

DateTime.local().setLocale('pt-BR');

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });

function gerarSlotsDia(dia, horaLimiteInicial) {
  const slots = [];
  let slot = dia.set({ hour: HORARIO_INICIO, minute: 0 });

  // se hoje, respeitar horaLimiteInicial (ex: agora + 3h)
  if (slot < horaLimiteInicial) {
    slot = horaLimiteInicial.plus({ minutes: -horaLimiteInicial.minute % SLOT_MINUTOS }); // arredondar para múltiplo
  }

  const ultimoSlot = dia.set({ hour: HORARIO_FIM, minute: 0 });

  while (slot <= ultimoSlot) {
    const proximo = slot.plus({ minutes: SLOT_MINUTOS });
    slots.push({ inicio: slot, fim: proximo });
    slot = proximo;
  }

  return slots;
}

function slotLivre(slot, eventos) {
  return !eventos.some(evento =>
    slot.inicio < evento.fim && slot.fim > evento.inicio
  );
}

async function obterHorariosDisponiveis(diasAdiante = 5) {
  const agora = DateTime.local();
  const limiteMinimo = agora.plus({ hours: 3 });
  const fim = agora.plus({ days: diasAdiante });

  const authClient = await auth.getClient();
  const res = await calendar.events.list({
    auth: authClient,
    calendarId: CALENDAR_ID,
    timeMin: agora.toISO(),
    timeMax: fim.toISO(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const eventos = res.data.items.map(evento => ({
    inicio: DateTime.fromISO(evento.start.dateTime || evento.start.date),
    fim: DateTime.fromISO(evento.end.dateTime || evento.end.date),
  }));

  const horariosDisponiveis = [];

  for (let i = 0; i <= diasAdiante; i++) {
    const dia = agora.plus({ days: i }).startOf('day');
    const slots = gerarSlotsDia(dia, limiteMinimo);
    const livres = slots.filter(slot => slotLivre(slot, eventos));

    livres.forEach(slot => {
      horariosDisponiveis.push(slot.inicio.setLocale('pt-BR').toFormat('cccc dd/MM HH:mm'));
    });
  }

  return horariosDisponiveis;
}

module.exports = { obterHorariosDisponiveis };