const { google } = require("googleapis");
const { HORARIO_INICIO, HORARIO_FIM, SLOT_MINUTOS, INTERVALO_AGENDAMENTO, DIAS_LIMITE, CALENDAR_ID } = require("./config");
const { DateTime, Settings } = require("luxon");

Settings.defaultLocale = "pt-BR"; // Define o locale padrão para todas as instâncias Luxon

const auth = new google.auth.GoogleAuth({
	scopes: ["https://www.googleapis.com/auth/calendar"],
});

const calendar = google.calendar({ version: "v3", auth });

class CalendarService {
	static async obterHorariosDisponiveis() {
		const agora = DateTime.local().setZone("America/Sao_Paulo");
		const limiteMinimo = agora.plus({ hours: INTERVALO_AGENDAMENTO });
		const fim = agora.plus({ days: DIAS_LIMITE });

		const authClient = await auth.getClient();
		const res = await calendar.events.list({
			auth: authClient,
			calendarId: CALENDAR_ID,
			timeMin: agora.toISO(),
			timeMax: fim.toISO(),
			singleEvents: true,
			orderBy: "startTime",
		});

		const eventos = res.data.items.map(evento => ({
			inicio: DateTime.fromISO(evento.start.dateTime || evento.start.date),
			fim: DateTime.fromISO(evento.end.dateTime || evento.end.date),
		}));

		const horariosDisponiveis = [];

		for (let i = 0; i <= DIAS_LIMITE; i++) {
			const dia = agora.plus({ days: i }).startOf("day");
			const slots = CalendarService.gerarSlotsDia(dia, limiteMinimo);
			const livres = slots.filter(slot => CalendarService.slotLivre(slot, eventos));

			livres.forEach(slot => {
				horariosDisponiveis.push(slot.inicio.toFormat("cccc dd/MM HH:mm"));
			});
		}

		return horariosDisponiveis;
	}

	static async verificarAgendamentoExistente(nome, cpf) {
		// Exemplo: busca eventos que tenham nome e cpf no summary ou description
		const agora = DateTime.local().setZone("America/Sao_Paulo");
		const fim = agora.plus({ days: 30 }); // busca eventos nos próximos 30 dias

		const authClient = await auth.getClient();
		const res = await calendar.events.list({
			auth: authClient,
			calendarId: CALENDAR_ID,
			timeMin: agora.toISO(),
			timeMax: fim.toISO(),
			singleEvents: true,
			orderBy: "startTime",
			q: nome // busca por nome no summary/description
		});

		// Filtro adicional por CPF se necessário
		const eventos = res.data.items.filter(evento => {
			const descricao = (evento.description || "") + (evento.summary || "");
			return descricao.includes(nome) && descricao.includes(cpf);
		}).map(evento => ({
			inicio: DateTime.fromISO(evento.start.dateTime || evento.start.date, { zone: "America/Sao_Paulo" }),
			fim: DateTime.fromISO(evento.end.dateTime || evento.end.date, { zone: "America/Sao_Paulo" }),
			summary: evento.summary,
			description: evento.description,
			id: evento.id,
		}));
		console.info(`Eventos encontrados: ${eventos.length}`);
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

	static async agendarConsulta(nomeCompleto, cpf, horarioSelecionado) {

		const inicio = horarioSelecionado;
		const fim = inicio.plus({ minutes: SLOT_MINUTOS });

		const evento = {
			summary: `Consulta com ${nomeCompleto} - CPF: ${cpf}`,
			description: `CPF: ${cpf}`,
			start: {
				dateTime: inicio.toISO(),
				timeZone: "America/Sao_Paulo",
			},
			end: {
				dateTime: fim.toISO(),
				timeZone: "America/Sao_Paulo",
			},
		};

		const authClient = await auth.getClient();
		const res = await calendar.events.insert({
			auth: authClient,
			calendarId: CALENDAR_ID,
			requestBody: evento,
		});

		console.info(`Consulta agendada:`, res.data);
		return res.data.id; // Retorna o ID do evento agendado
	}

	//método para get evento by id
	static async getEventoById(eventoId) {
		if (!eventoId) {
			throw new Error("ID do evento não fornecido");
		}

		const authClient = await auth.getClient();
		const res = await calendar.events.get({
			auth: authClient,
			calendarId: CALENDAR_ID,
			eventId: eventoId
		});
		const evento = res.data;

		if (!evento) {
			console.warn(`Nenhum evento encontrado com o ID: ${eventoId}`);
			return null;
		}
		// Exclui eventos que foram removidos (status: "cancelled")
		else if (evento?.status === "cancelled") {
			console.info(`Evento ${eventoId} está cancelado/deletado e será ignorado.`);
			return null;
		}

		return {
			inicio: DateTime.fromISO(evento.start.dateTime || evento.start.date, { zone: "America/Sao_Paulo" }),
			fim: DateTime.fromISO(evento.end.dateTime || evento.end.date, { zone: "America/Sao_Paulo" }),
			summary: evento.summary,
			description: evento.description,
			id: evento.id,
		};
	}

	//método para cancelar agendamento, necessita nome, cpf e id do evento
	static async cancelarConsulta(nome, cpf, eventoId, eventoObj) {
		if (!nome || !cpf || !eventoId) {
			throw new Error("Dados incompletos para cancelamento");
		}

		const evento = eventoObj || await CalendarService.getEventoById(eventoId);
		if (!evento ) {
			throw new Error("Nenhum agendamento encontrado para cancelamento, talvez já tenha sido cancelado.");
		}

		console.info(`Evento encontrado para cancelamento: `, evento);

		if (!evento.summary.includes(nome) || !evento.description.includes(cpf)) {
			throw new Error("O evento não corresponde ao nome e CPF fornecidos.");
		}

		const authClient = await auth.getClient();
		//
		await calendar.events.delete({
			auth: authClient,
			calendarId: CALENDAR_ID,
			eventId: eventoId,
		});

		console.info(`Consulta cancelada: ${nome}, CPF: ${cpf}, Evento ID: ${eventoId}, Data: ${evento.inicio}`);
		return true;
	}
}

module.exports = CalendarService;
