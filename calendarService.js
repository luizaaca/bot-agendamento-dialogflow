import { google } from "googleapis";
import { DateTime, Settings } from "luxon";
import { config } from "./config.js";

Settings.defaultLocale = "pt-BR"; // Define o locale padrão para todas as instâncias Luxon

const auth = new google.auth.GoogleAuth({
	scopes: ["https://www.googleapis.com/auth/calendar"],
});

const calendar = google.calendar({ version: "v3", auth });

class CalendarService {
	constructor(traceId) {
		this.traceId = traceId;
	}

	/**
     * Retorna uma lista de horários disponíveis para agendamento, considerando os eventos já existentes no calendário.
     * @returns {Promise<Array<string>>} Lista de horários disponíveis formatados.
     */
	async obterHorariosDisponiveis() {
		const agora = DateTime.local().setZone("America/Sao_Paulo");
		const limiteMinimo = agora.plus({ hours: config.INTERVALO_AGENDAMENTO });
		const fim = agora.plus({ days: config.DIAS_LIMITE });

		const authClient = await auth.getClient();
		const res = await calendar.events.list({
			auth: authClient,
			calendarId: config.CALENDAR_ID,
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

		for (let i = 0; i <= config.DIAS_LIMITE; i++) {
			const dia = agora.plus({ days: i }).startOf("day");
			const slots = this.#gerarSlotsDia(dia, limiteMinimo);
			const livres = slots.filter(slot => this.#slotLivre(slot, eventos));

			livres.forEach(slot => {
				horariosDisponiveis.push(slot.inicio.toFormat("cccc dd/MM HH:mm"));
			});
		}
		return horariosDisponiveis;
	}

	/**
     * Busca eventos existentes no calendário que contenham o nome e CPF informados.
     * @param {string} nome - Nome do paciente.
     * @param {string} cpf - CPF do paciente.
     * @returns {Promise<Array<Object>>} Lista de eventos encontrados.
     */
	async verificarAgendamentoExistente(nome, cpf) {
		const agora = DateTime.local().setZone("America/Sao_Paulo");
		const fim = agora.plus({ days: 30 });

		const authClient = await auth.getClient();
		const res = await calendar.events.list({
			auth: authClient,
			calendarId: config.CALENDAR_ID,
			timeMin: agora.toISO(),
			timeMax: fim.toISO(),
			singleEvents: true,
			orderBy: "startTime",
			q: nome
		});

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
		console.info({
			origem: "[CalendarService.verificarAgendamentoExistente]",
			mensagem: "Eventos encontrados para nome e CPF",
			detalhes: { quantidade: eventos.length },
			traceId: this.traceId
		});
		return eventos;
	}

	/**
     * Gera os slots de horários disponíveis para um determinado dia, considerando o horário de início e fim.
     * @private
     */
	#gerarSlotsDia(dia, horaLimiteInicial) {
		const slots = [];
		let slot = dia.set({ hour: config.HORARIO_INICIO, minute: 0 });

		if (slot < horaLimiteInicial) {
			slot = horaLimiteInicial.plus({ minutes: -horaLimiteInicial.minute % config.SLOT_MINUTOS });
		}

		const ultimoSlot = dia.set({ hour: config.HORARIO_FIM, minute: 0 });

		while (slot <= ultimoSlot) {
			const proximo = slot.plus({ minutes: config.SLOT_MINUTOS });
			slots.push({ inicio: slot, fim: proximo });
			slot = proximo;
		}

		return slots;
	}

	/**
     * Verifica se um slot está livre, ou seja, não há eventos sobrepostos.
     * @private
     */
	#slotLivre(slot, eventos) {
		return eventos.every(evento =>
			slot.fim <= evento.inicio || slot.inicio >= evento.fim
		);
	}

	/**
     * Agenda uma nova consulta no calendário, verificando conflitos de horário.
     * @param {string} nomeCompleto - Nome do paciente.
     * @param {string} cpf - CPF do paciente.
     * @param {DateTime} horarioSelecionado - Data/hora de início da consulta (Luxon).
     * @returns {Promise<string>} ID do evento agendado.
     * @throws {Error} Se houver conflito de horário.
     */
	async agendarConsulta(nomeCompleto, cpf, horarioSelecionado) {

		const inicio = horarioSelecionado;
		const fim = inicio.plus({ minutes: config.SLOT_MINUTOS });

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

		const eventosExistentes = await this.getEventosByDateTime(inicio, fim);
		if(eventosExistentes.some(eventoExistente => inicio === eventoExistente.inicio))
			throw new Error("Horário selecionado já está ocupado. Por favor, escolha outro horário.");

		const authClient = await auth.getClient();
		const res = await calendar.events.insert({
			auth: authClient,
			calendarId: config.CALENDAR_ID,
			requestBody: evento,
		});

		console.info({
			origem: "[CalendarService.agendarConsulta]",
			mensagem: "Consulta agendada",
			detalhes: res.data,
			traceId: this.traceId
		});

		return res.data.id; // Retorna o ID do evento agendado
	}

	/**
     * Busca um evento do calendário pelo seu ID.
     * @param {string} eventoId - ID do evento no Google Calendar.
     * @returns {Promise<Object|null>} Objeto do evento ou null se não encontrado/cancelado.
     * @throws {Error} Se o ID não for fornecido.
     */
	async getEventoById(eventoId) {
		if (!eventoId) {
			throw new Error("ID do evento não fornecido");
		}

		const authClient = await auth.getClient();
		const res = await calendar.events.get({
			auth: authClient,
			calendarId: config.CALENDAR_ID,
			eventId: eventoId
		});
		const evento = res.data;

		if (!evento) {
			console.warn({
				origem: "[CalendarService.getEventoById]",
				mensagem: `Nenhum evento encontrado com o ID.`,
				detalhes: { eventoId },
				traceId: this.traceId
			});
			return null;
		}
		// Exclui eventos que foram removidos (status: "cancelled")
		else if (evento?.status === "cancelled") {
			console.info({
				origem: "[CalendarService.getEventoById]",
				mensagem: `Evento está cancelado/deletado e será ignorado.`,
				detalhes: { eventoId },
				traceId: this.traceId
			});
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

	/**
     * Cancela uma consulta agendada no calendário.
     * @param {string} nome - Nome do paciente.
     * @param {string} cpf - CPF do paciente.
     * @param {string} eventoId - ID do evento a ser cancelado.
     * @param {Object} [eventoObj] - Objeto do evento (opcional, para evitar nova busca).
     * @returns {Promise<boolean>} True se o cancelamento foi realizado.
     * @throws {Error} Se dados estiverem incompletos ou o evento não for encontrado.
     */
	async cancelarConsulta(nome, cpf, eventoId, eventoObj) {
		if (!nome || !cpf || !eventoId) {
			throw new Error("Dados incompletos para cancelamento");
		}

		const evento = eventoObj || await this.getEventoById(eventoId);
		if (!evento ) {
			throw new Error("Nenhum agendamento encontrado para cancelamento, talvez já tenha sido cancelado.");
		}

		console.info({
			origem: "[CalendarService.cancelarConsulta]",
			mensagem: "Evento encontrado para cancelamento",
			detalhes: evento,
			traceId: this.traceId
		});

		if (!evento.summary.includes(nome) || !evento.description.includes(cpf)) {
			throw new Error("O evento não corresponde ao nome e CPF fornecidos.");
		}

		const authClient = await auth.getClient();
		await calendar.events.delete({
			auth: authClient,
			calendarId: config.CALENDAR_ID,
			eventId: eventoId,
		});

		console.info({
			origem: "[CalendarService.cancelarConsulta]",
			mensagem: "Consulta cancelada",
			detalhes: {
				nome,
				cpf,
				eventoId,
				data: evento.inicio
			},
			traceId: this.traceId
		});

		return true;
	}

	/**
     * Retorna todos os eventos do calendário que iniciam ou terminam entre os horários informados.
     * Exclui eventos cancelados.
     * @param {DateTime} inicio - Data/hora de início do intervalo (Luxon)
     * @param {DateTime} fim - Data/hora de fim do intervalo (Luxon)
     * @returns {Promise<Array>} Lista de eventos encontrados
     */
	async getEventosByDateTime(inicio, fim) {
		const authClient = await auth.getClient();
		const res = await calendar.events.list({
			auth: authClient,
			calendarId: config.CALENDAR_ID,
			timeMin: inicio.toISO(),
			timeMax: fim.toISO(),
			singleEvents: true,
			orderBy: "startTime",
		});
		const eventos = (res.data.items || [])
			.filter(evento => evento.status !== "cancelled")
			.map(evento => ({
				inicio: DateTime.fromISO(evento.start.dateTime || evento.start.date, { zone: "America/Sao_Paulo" }),
				fim: DateTime.fromISO(evento.end.dateTime || evento.end.date, { zone: "America/Sao_Paulo" }),
				summary: evento.summary,
				description: evento.description,
				id: evento.id,
			}));

		console.info({
			origem: "[CalendarService.getEventosByDateTime]",
			mensagem: "Eventos retornados para o intervalo solicitado",
			detalhes: { quantidade: eventos.length, inicio: inicio.toISO(), fim: fim.toISO() },
			traceId: this.traceId
		});

		return eventos;
	}
}

export default CalendarService;
