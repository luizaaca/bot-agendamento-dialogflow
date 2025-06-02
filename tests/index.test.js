import { describe, it, expect, jest } from "@jest/globals";
import { DateTime } from "luxon";
import * as index from "../src/index.js";

// Mock do CalendarService
jest.mock("../src/calendarService.js", () => {
	return {
		default: jest.fn().mockImplementation(() => ({
			verificarAgendamentoExistente: jest.fn().mockResolvedValue([]),
			obterHorariosDisponiveis: jest.fn().mockResolvedValue(["segunda 03/06 10:00"]),
			agendarConsulta: jest.fn().mockResolvedValue("evento123"),
			cancelarConsulta: jest.fn().mockResolvedValue(true),
			getEventoById: jest.fn().mockResolvedValue({
				inicio: DateTime.now(),
				fim: DateTime.now().plus({ minutes: 60 }),
				summary: "Consulta com Teste - CPF: 12345678900",
				description: "CPF: 12345678900",
				id: "evento123"
			}),
			remarcarConsulta: jest.fn().mockResolvedValue(true)
		}))
	};
});

// Mock do WebhookClient e Suggestion
jest.mock("dialogflow-fulfillment", () => {
	return {
		WebhookClient: jest.fn().mockImplementation(() => ({
			parameters: {},
			add: jest.fn(),
			setContext: jest.fn(),
			getContext: jest.fn().mockReturnValue({ parameters: { paciente: { name: "Teste" }, cpf: "12345678900" } })
		})),
		Suggestion: jest.fn()
	};
});

describe("dialogflowWebhook", () => {
	it("deve processar uma requisição básica sem erros", async () => {
		const req = {
			body: {
				responseId: "trace-abc-123",
				originalDetectIntentRequest: null
			}
		};
		const res = {};
		// Função não retorna nada, mas não deve lançar erro
		await expect(index.dialogflowWebhook(req, res)).resolves.toBeUndefined();
	});
});