const { google } = require('googleapis');
const { HORARIO_INICIO, HORARIO_FIM, SLOT_MINUTOS, INTERVALO_AGENDAMENTO, DIAS_LIMITE, CALENDAR_ID } = require('./config');
const { DateTime } = require('luxon'); 

DateTime.local().setLocale('pt-BR');

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });

class CalendarService {
  static async obterHorariosDisponiveis() {
    const agora = DateTime.local();
    const limiteMinimo = agora.plus({ hours: 3 });
    const fim = agora.plus({ days: DIAS_LIMITE });

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

    for (let i = 0; i <= DIAS_LIMITE; i++) {
      const dia = agora.plus({ days: i }).startOf('day');
      const slots = CalendarService.gerarSlotsDia(dia, limiteMinimo);
      const livres = slots.filter(slot => CalendarService.slotLivre(slot, eventos));

      livres.forEach(slot => {
        horariosDisponiveis.push(slot.inicio.setLocale('pt-BR').toFormat('cccc dd/MM HH:mm'));
      });
    }

    return horariosDisponiveis;
  }

  static async verificarAgendamentoExistente(nome, cpf) {
    // Exemplo: busca eventos que tenham nome e cpf no summary ou description
    const agora = DateTime.local();
    const fim = agora.plus({ days: 30 }); // busca eventos nos próximos 30 dias

    const authClient = await auth.getClient();
    const res = await calendar.events.list({
      auth: authClient,
      calendarId: CALENDAR_ID,
      timeMin: agora.toISO(),
      timeMax: fim.toISO(),
      singleEvents: true,
      orderBy: 'startTime',
      q: nome // busca por nome no summary/description
    });

    // Filtro adicional por CPF se necessário
    const eventos = res.data.items.filter(evento => {
      const descricao = (evento.description || '') + (evento.summary || '');
      return descricao.includes(nome) && descricao.includes(cpf);
    }).map(evento => ({
      inicio: DateTime.fromISO(evento.start.dateTime || evento.start.date),
      fim: DateTime.fromISO(evento.end.dateTime || evento.end.date),
      summary: evento.summary,
      description: evento.description,
      id: evento.id,
    }));

    return eventos;
  }

  static gerarSlotsDia(dia, horaLimiteInicial) {
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

  static slotLivre(slot, eventos) {
    // Refatorado para lógica correta de não sobreposição
    return eventos.every(evento =>
      slot.fim <= evento.inicio || slot.inicio >= evento.fim
    );
  }
}

module.exports = CalendarService;