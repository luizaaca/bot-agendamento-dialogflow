import { jest, describe, it, expect } from "@jest/globals";
import { DateTime } from "luxon";
import CalendarService from "../src/calendarService.js";

const mockEvent = {
	start: { dateTime: DateTime.now().toISO({ zone: "America/Sao_Paulo" }) },
	end: { dateTime: DateTime.now().plus({ minutes: 60 }).toISO({ zone: "America/Sao_Paulo" }) },
	summary: "Consulta com Nome Teste - CPF: 12345678900",
	description: "CPF: 12345678900",
	id: "evento123",
	status: "confirmed"
};
const mockAuth = {
	getClient: jest.fn().mockResolvedValue({}),
};
const mockCalendar = {
	events: {
		list: jest.fn().mockResolvedValue({ data: { items: [] } }),
		insert: jest.fn().mockResolvedValue({ data: { id: "evento123" } }),
		get: jest.fn().mockResolvedValue({
			data: mockEvent
		}),
		delete: jest.fn().mockResolvedValue({}),
	}
};

describe("CalendarService", () => {
	it("deve instanciar com traceId", () => {
		const service = new CalendarService("abc123", { calendar: mockCalendar, auth: mockAuth });
		expect(service.traceId).toBe("abc123");
	});

	it("deve retornar um array de horários disponíveis", async () => {
		const service = new CalendarService("test", { calendar: mockCalendar, auth: mockAuth });
		const horarios = await service.obterHorariosDisponiveis();
		expect(Array.isArray(horarios)).toBe(true);
	});

	it("deve agendar uma consulta e retornar o id do evento", async () => {
		const service = new CalendarService("test", { calendar: mockCalendar, auth: mockAuth });
		const id = await service.agendarConsulta("Nome Teste", "12345678900", DateTime.now());
		expect(id).toBe("evento123");
	});

	it("deve buscar um evento pelo id", async () => {
		const service = new CalendarService("test", { calendar: mockCalendar, auth: mockAuth });
		const evento = await service.getEventoById("evento123");
		expect(evento.inicio.toISO()).toBe(mockEvent.start.dateTime);
		expect(evento.fim.toISO()).toBe(mockEvent.end.dateTime);
		expect(evento.summary).toBe(mockEvent.summary);
		expect(evento.description).toBe(mockEvent.description);
		expect(evento.id).toBe(mockEvent.id);
	});

	it("deve cancelar uma consulta sem lançar erro", async () => {
		const service = new CalendarService("test", { calendar: mockCalendar, auth: mockAuth });
		await expect(service.cancelarConsulta("Nome Teste", "12345678900", "evento123")).resolves.toBe(true);
	});
});