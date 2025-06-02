import CalendarService from "../src/calendarService.js";
import { DateTime } from "luxon";
import { describe, it, expect, jest } from "@jest/globals";

// Mock das dependências externas
jest.mock("googleapis", () => {
	return {
		google: {
			auth: {
				GoogleAuth: jest.fn().mockImplementation(() => ({
					getClient: jest.fn().mockResolvedValue({}),
				})),
			},
			calendar: jest.fn().mockReturnValue({
				events: {
					list: jest.fn().mockResolvedValue({
						data: {
							items: []
						}
					}),
					insert: jest.fn().mockResolvedValue({
						data: { id: "evento123" }
					}),
					get: jest.fn().mockResolvedValue({
						data: {
							start: { dateTime: DateTime.now().toISO() },
							end: { dateTime: DateTime.now().plus({ minutes: 60 }).toISO() },
							summary: "Consulta",
							description: "CPF: 12345678900",
							id: "evento123",
							status: "confirmed"
						}
					}),
					delete: jest.fn().mockResolvedValue({}),
				}
			}),
		}
	};
});

describe("CalendarService", () => {
	it("deve instanciar com traceId", () => {
		const service = new CalendarService("abc123");
		expect(service.traceId).toBe("abc123");
	});

	it("deve retornar um array de horários disponíveis", async () => {
		const service = new CalendarService("test");
		const horarios = await service.obterHorariosDisponiveis();
		expect(Array.isArray(horarios)).toBe(true);
	});

	it("deve agendar uma consulta e retornar o id do evento", async () => {
		const service = new CalendarService("test");
		const id = await service.agendarConsulta("Nome Teste", "12345678900", DateTime.now());
		expect(id).toBe("evento123");
	});

	it("deve buscar um evento pelo id", async () => {
		const service = new CalendarService("test");
		const evento = await service.getEventoById("evento123");
		expect(evento).toHaveProperty("inicio");
		expect(evento).toHaveProperty("fim");
		expect(evento).toHaveProperty("summary");
		expect(evento).toHaveProperty("description");
		expect(evento).toHaveProperty("id");
	});

	it("deve cancelar uma consulta sem lançar erro", async () => {
		const service = new CalendarService("test");
		await expect(service.cancelarConsulta("Nome Teste", "12345678900", "evento123", {
			summary: "Consulta com Nome Teste - CPF: 12345678900",
			description: "CPF: 12345678900",
			inicio: DateTime.now()
		})).resolves.toBe(true);
	});
});