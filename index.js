import functions from "@google-cloud/functions-framework";
import { WebhookClient, Suggestion } from "dialogflow-fulfillment";
import CalendarService from "./calendarService.js";
import { DateTime } from "luxon";

// Função utilitária para validar CPF (apenas verifica se tem 11 dígitos numéricos)
function cpfValido(agent, nomeCompleto, cpf, origem) {
	if (cpf.length !== 11) {
		console.warn({
			origem,
			mensagem: "CPF inválido",
			detalhes: { nomeCompleto, cpf }
		});
		agent.add("Por favor, informe um CPF válido com 11 dígitos.");
		return false;
	}
	return true;
}

async function dialogflowWebhook(req, res) {
	const traceId = req.body.responseId;
	const calendarService = new CalendarService(traceId);

	if (req.body.originalDetectIntentRequest) {
		console.warn({
			origem: "[Webhook]",
			mensagem: `Interceptando chamada do Console do Dialogflow com originalDetectIntentRequest.source: ${req.body.originalDetectIntentRequest.source}`,
			traceId: traceId
		});
		req.body.originalDetectIntentRequest = {}; // Limpa o source para evitar problemas com o Dialogflow Console
	}
	const agent = new WebhookClient({ request: req, response: res });

	// Função para o Default Welcome Intent
	function welcome(agent) {
		console.info({
			origem: "[Welcome]",
			mensagem: "Dados coletados",
			detalhes: agent.parameters,
			traceId: traceId
		});

		// Envia a pergunta inicial para o usuário
		agent.add("Olá! Por favor informe seu nome, ultimo sobrenome e CPF para que eu possa verificar suas consultas." );
	}

	// Função para o Coletar Dados Iniciais
	async function coletarDadosIniciais(agent) {
		const nomeCompleto = agent.parameters.paciente?.name;
		const cpf = agent.parameters.cpf.replace(/\D/g, "");

		console.info({
			origem: "[ColetarDadosIniciais]",
			mensagem: "Dados coletados",
			detalhes: agent.parameters,
			traceId: traceId
		});

		if (!nomeCompleto || !cpf) {
			console.warn({
				origem: "[ColetarDadosIniciais]",
				mensagem: "Dados incompletos para verificação de consultas",
				detalhes: { nomeCompleto, cpf },
				traceId: traceId
			});
			agent.add("Desculpe, não consegui entender seu nome completo ou CPF. Por favor, tente novamente.");
			return;
		}

		if (!cpfValido(agent, nomeCompleto, cpf, "[ColetarDadosIniciais]")) {
			return;
		}

		try {
			const consultas = await calendarService.verificarAgendamentoExistente(
				nomeCompleto,
				cpf
			);

			if (consultas && consultas.length > 0) {
				// Monta a mensagem com as consultas
				let mensagem = `Encontrei a(s) seguinte(s) consulta(s) para você:\n\n`;
				consultas.forEach((consulta) => { mensagem += `- ${consulta.inicio.toFormat("cccc dd/MM/yyyy HH:mm")}\n`; });
				mensagem += "\nVocê deseja remarcar ou cancelar essa consulta?";

				agent.add(mensagem);

				// Adiciona as opções como chips
				agent.add(new Suggestion("Remarcar consulta"));
				agent.add(new Suggestion("Cancelar consulta"));
				agent.add(new Suggestion("Reiniciar agendamento"));
				agent.add(new Suggestion("Sair"));

				// Ativa o contexto para os próximos Intents
				agent.setContext({
					name: "flow_consulta_encontrada_context",
					lifespan: 1,
					parameters: {...agent.parameters, idConsulta: consultas[0].id} // Passa os dados e consultas para os próximos intents
				});
			} else { // Nenhuma consulta encontrada
				console.info({
					origem: "[ColetarDadosIniciais]",
					mensagem: "Nenhuma consulta encontrada",
					detalhes: { nomeCompleto, cpf },
					traceId: traceId
				});
				agent.add(`Não encontrei nenhuma consulta marcada para ${nomeCompleto} com o CPF ${cpf}.`);
				agent.add("Você gostaria de marcar uma nova consulta?");

				// Adiciona a opção como chip
				agent.add(new Suggestion("Marcar nova consulta"));

				// Ativa o contexto para o próximo Intent
				agent.setContext({
					name: "flow_sem_consulta_context",
					lifespan: 1,
					parameters: agent.parameters, // Passa os dados para o próximo intent
				});
			}
		} catch (error) {
			console.error({
				origem: "[ColetarDadosIniciais]",
				mensagem: "Erro ao verificar consultas",
				erro: error,
				traceId: traceId
			});
			agent.add(
				"Desculpe, tive um problema ao verificar suas consultas. Por favor, tente novamente mais tarde."
			);
		}
	}

	// Função para marcar uma nova consulta, apresentando os horários disponíveis
	async function novaConsulta(agent) {
		const context = agent.getContext("flow_sem_consulta_context");

		const nomeCompleto = context.parameters.paciente?.name;
		const cpf = context.parameters.cpf.replace(/\D/g, "");

		console.info({
			origem: "[NovaConsulta]",
			mensagem: "Dados coletados",
			detalhes: { nomeCompleto, cpf },
			traceId: traceId
		});

		if (!nomeCompleto || !cpf) {
			console.warn({
				origem: "[NovaConsulta]",
				mensagem: "Dados incompletos para marcação de nova consulta",
				detalhes: { nomeCompleto, cpf },
				traceId: traceId
			});
			agent.add("Desculpe, não consegui entender seu nome completo ou CPF. Por favor, tente novamente.");
			return; // Interrompe a execução para que o Dialogflow espere uma nova entrada.
		}

		if (!cpfValido(agent, nomeCompleto, cpf, "[NovaConsulta]")) {
			return;
		}

		try {
			// Verifica se já existe uma consulta agendada
			const consultasExistentes = await calendarService.verificarAgendamentoExistente(nomeCompleto, cpf);

			if (consultasExistentes && consultasExistentes.length > 0) {
				console.info({
					origem: "[NovaConsulta]",
					mensagem: "Já existe uma consulta agendada",
					detalhes: { consultasExistentes, nomeCompleto, cpf },
					traceId: traceId
				});
				agent.add(`Você já possui uma consulta agendada para ${nomeCompleto} com o CPF ${cpf}.`);
				return; // Interrompe a execução, pois não é necessário marcar nova consulta, posteriormente redirecionar o usuário para optar por remarcar ou cancelar a consulta existente.
			}

			const horariosDisponiveis = await calendarService.obterHorariosDisponiveis();

			agent.add(`Olá ${nomeCompleto}, por favor, escolha um horário disponível abaixo:`);

			// Adiciona cada horário disponível como um chip
			horariosDisponiveis.forEach((horario) => {
				agent.add(new Suggestion(horario));
			});

			// Ativa o contexto para o próximo Intent de confirmação de agendamento
			agent.setContext({
				name: "flow_nova_consulta_horarios_context",
				lifespan: 1,
				parameters: {
					...context.parameters,
				},
			});
		} catch (error) {
			console.error({
				origem: "[NovaConsulta]",
				mensagem: "Erro ao iniciar marcação de nova consulta",
				erro: error,
				traceId: traceId
			});
			agent.add(
				"Desculpe, tive um problema ao tentar marcar uma nova consulta. Por favor, tente novamente mais tarde."
			);
		}
	}

	//Função para lidar com o Intent de Informar Horário, objetivo é chamar a função agendarConsulta na calendarService.js com nome, cpf e horário selecionado pelo usuário
	async function confirmarConsulta(agent) {
		const context = agent.getContext("flow_nova_consulta_horarios_context");
		const nomeCompleto = context.parameters.paciente?.name;
		const cpf = context.parameters.cpf.replace(/\D/g, "");
		const horarioSelecionado = DateTime.fromISO(agent.parameters.dataHora["date_time"], { zone: "America/Sao_Paulo" });

		console.info({
			origem: "[ConfirmarConsulta]",
			mensagem: "Dados coletados",
			detalhes: { nomeCompleto, cpf, horarioSelecionado },
			traceId: traceId
		});

		if (!nomeCompleto || !cpf || !horarioSelecionado) {
			console.warn({
				origem: "[ConfirmarConsulta]",
				mensagem: "Dados incompletos para agendamento",
				detalhes: { nomeCompleto, cpf, horarioSelecionado },
				traceId: traceId
			});
			agent.add("Desculpe, não consegui entender seu nome, CPF ou horário selecionado. Por favor, tente novamente.");
			return; // Interrompe a execução para que o Dialogflow espere uma nova entrada.
		}
		if (!cpfValido(agent, nomeCompleto, cpf, "[ConfirmarConsulta]")) {
			return;
		}

		try {
			// Verifica se já existe uma consulta agendada
			const consultasExistentes = await calendarService.verificarAgendamentoExistente(nomeCompleto, cpf);
			if (consultasExistentes && consultasExistentes.length > 0) {
				console.info({
					origem: "[ConfirmarConsulta]",
					mensagem: "Já existem consultas agendadas",
					detalhes: consultasExistentes,
					traceId: traceId
				});
				agent.add(`Já existe uma consulta agendada para ${nomeCompleto} com o CPF ${cpf} em ${consultasExistentes[0].inicio.toFormat("cccc dd/MM/yyyy HH:mm")}.`);
				return; // Interrompe a execução, pois não é necessário agendar nova consulta
			}
			// Chama a função de agendamento na CalendarService
			await calendarService.agendarConsulta(nomeCompleto, cpf, horarioSelecionado);
			agent.add(`Consulta agendada com sucesso para ${horarioSelecionado.toFormat("cccc dd/MM/yyyy HH:mm")}!`);
		} catch (error) {
			console.error({
				origem: "[ConfirmarConsulta]",
				mensagem: "Erro ao agendar consulta",
				erro: error,
				traceId: traceId
			});
			agent.add("Desculpe, tive um problema ao tentar agendar sua consulta. Por favor, tente novamente mais tarde.");
		}
	}

	// Função para cancelar uma consulta
	async function cancelarConsulta(agent) {
		const context = agent.getContext("flow_consulta_encontrada_context");
		const nomeCompleto = context?.parameters?.paciente?.name;
		const cpf = context?.parameters?.cpf.replace(/\D/g, "");
		const idConsulta = context?.parameters?.idConsulta;

		console.info({
			origem: "[CancelarConsulta]",
			mensagem: "Dados coletados",
			detalhes: { ...agent.parameters, nomeCompleto, cpf, idConsulta },
			traceId: traceId
		});

		if(agent.parameters?.resposta?.toLowerCase() === "nao" || agent.parameters?.resposta?.toLowerCase() === "não") {
			agent.add("Ok, sua consulta não será cancelada.");
			agent.add("Se precisar de mais alguma coisa, é só chamar!");
			return;
		}
		else if(agent.parameters?.resposta?.toLowerCase() === "sim") {
			if (!nomeCompleto || !cpf || !idConsulta) {
				agent.add("Desculpe, não consegui identificar a consulta a ser cancelada. Por favor, tente novamente.");
				return;
			}
			if (!cpfValido(agent, nomeCompleto, cpf, "[CancelarConsulta]")) return;

			try {
				await calendarService.cancelarConsulta(nomeCompleto, cpf, idConsulta);
				agent.add("Sua consulta foi cancelada com sucesso. Se precisar de mais alguma coisa, é só chamar!");
			} catch (error) {
				console.error({
					origem: "[CancelarConsulta]",
					mensagem: "Erro ao cancelar consulta",
					erro: error,
					traceId: traceId
				});
				agent.add(`Desculpe, tive um problema ao tentar cancelar sua consulta: ${error.message}`);
			}

		}else{
			await solicitarConfirmacao(agent, context, "cancelar");
			return;
		}
	}

	// Função para solicitar remarcação de consulta
	async function solicitarRemarcacao(agent) {
		const context = agent.getContext("flow_consulta_encontrada_context");
		const nomeCompleto = context?.parameters?.paciente?.name;
		const cpf = context?.parameters?.cpf.replace(/\D/g, "");
		const idConsulta = context?.parameters?.idConsulta;

		console.info({
			origem: "[SolicitarRemarcacao]",
			mensagem: "Dados coletados",
			detalhes: { ...agent.parameters, nomeCompleto, cpf, idConsulta },
			traceId: traceId
		});

		if (!nomeCompleto || !cpf || !idConsulta) {
			agent.add("Desculpe, não consegui identificar a consulta a ser remarcada. Por favor, tente novamente.");
			return;
		}

		try {
			const consultaAgendada = await calendarService.getEventoById(idConsulta);
			if (!consultaAgendada || !consultaAgendada.summary.includes(nomeCompleto) || !consultaAgendada.summary.includes(cpf)) {
				agent.add("Desculpe, ocorreu algum erro e não consegui encontrar a consulta a ser remarcada. Por favor, inicie o processo novamente.");
				return;
			}

			const horariosDisponiveis = await calendarService.obterHorariosDisponiveis();

			// Substituir a lista numerada por chips
			agent.add(`Olá ${nomeCompleto}, por favor, escolha um horário disponível abaixo:`);

			// Adiciona cada horário disponível como um chip
			horariosDisponiveis.forEach((horario) => {
				agent.add(new Suggestion(horario));
			});
			agent.setContext({
				name: "flow_remarcar_consulta_context",
				lifespan: 1,
				parameters: { ...context.parameters, idConsulta }
			});
		} catch (error) {
			console.error({
				origem: "[SolicitarRemarcacao]",
				mensagem: "Erro ao verificar o calendario",
				erro: error,
				traceId: traceId
			});
			agent.add("Desculpe, tive um problema ao verificar o calendário. Por favor, inicie o processo novamente.");
		}
	}

	// Função para remarcar uma consulta
	async function remarcarConsulta(agent) {
		const context = agent.getContext("flow_remarcar_consulta_context");
		const nomeCompleto = context?.parameters?.paciente?.name;
		const cpf = context?.parameters?.cpf.replace(/\D/g, "");
		const idConsulta = context?.parameters?.idConsulta;
		const horarioSelecionado = agent.parameters?.dateTime ? DateTime.fromISO(agent.parameters?.dateTime["date_time"], { zone: "America/Sao_Paulo" }) : null;

		if(!nomeCompleto || !cpf || !idConsulta || !horarioSelecionado) {
			agent.add("Desculpe, não consegui identificar a consulta a ser remarcada. Por favor, inicie o processo novamente.");
			console.warn({
				origem: "[RemarcarConsulta]",
				mensagem: "Dados incompletos para remarcação",
				detalhes: { nomeCompleto, cpf, idConsulta, horarioSelecionado },
				traceId: traceId
			});
			return;
		}

		console.info({
			origem: "[RemarcarConsulta]",
			mensagem: "Dados coletados",
			detalhes: { ...agent.parameters, nomeCompleto, cpf, idConsulta, horarioSelecionado },
			traceId: traceId
		});

		if(agent.parameters?.resposta?.toLowerCase() === "nao" || agent.parameters?.resposta?.toLowerCase() === "não") {
			agent.add("Ok, sua consulta não será remarcada.");
			agent.add("Se precisar de mais alguma coisa, é só chamar!");
			return;
		}
		else if(agent.parameters?.resposta?.toLowerCase() === "sim"){
			try {
				const consultaAgendada = await calendarService.getEventoById(idConsulta);
				if (!consultaAgendada) {
					agent.add("Desculpe, ocorreu algum erro e não consegui encontrar a consulta a ser remarcada. Por favor, inicie o processo novamente.");
					return;
				}
				if(consultaAgendada.inicio.toISO() === horarioSelecionado.toISO()) {
					agent.add("O horário selecionado é o mesmo da consulta atual. Por favor, escolha um horário diferente.");
					return;
				}
				if(await calendarService.agendarConsulta(nomeCompleto, cpf, horarioSelecionado)) {
					await calendarService.cancelarConsulta(nomeCompleto, cpf, idConsulta, consultaAgendada);
					agent.add(`Sua consulta foi remarcada com sucesso de ${consultaAgendada.inicio.toFormat("dd/MM/yyyy HH:mm")} para ${horarioSelecionado.toFormat("dd/MM/yyyy HH:mm")}`);
				}
			} catch (error) {
				console.error({
					origem: "[RemarcarConsulta]",
					mensagem: "Erro ao remarcar consulta",
					erro: error,
					traceId: traceId
				});
				agent.add(`Desculpe, tive um problema ao tentar remarcar sua consulta: ${error.message}. Inicie o processo novamente.`);
				return;
			}
		}else{
			await solicitarConfirmacao(agent, context, "remarcar");
			return;
		}
	}

	async function confirmarAcao(agent) {
		const contextResposta = agent.getContext("flow_confirmar_acao_context");
		const acao = contextResposta?.parameters?.acao;
		const resposta = agent.parameters.resposta.toLowerCase();
		const cpf = contextResposta?.parameters?.cpf.replace(/\D/g, "");
		agent.parameters.resposta = resposta;

		console.info({
			origem: "[ConfirmarAcao]",
			mensagem: "Dados coletados",
			detalhes: { acao, resposta, cpf },
			traceId: traceId
		});

		if (acao === "cancelar") {
			await cancelarConsulta(agent);
		} else if (acao === "remarcar") {
			await remarcarConsulta(agent);
		} else {
			agent.add("Desculpe, ocorreu um erro e não entendi a ação que você deseja confirmar. Inicie o processo novamente.");
			return;
		}
	}

	async function solicitarConfirmacao(agent, context, acao) {
		agent.add(`Por favor, responda com 'sim' ou 'não' para confirmar a ação de ${acao}.`);
		agent.setContext({
			name: "flow_confirmar_acao_context",
			lifespan: 1,
			parameters: {
				...context.parameters,
				acao: acao
			}
		});
		agent.setContext(context);
	}

	const intentMap = new Map();
	intentMap.set("Default Welcome Intent", welcome);
	intentMap.set("ColetarDados", coletarDadosIniciais);
	intentMap.set("AgendarConsulta", novaConsulta);
	intentMap.set("InformarHorario", confirmarConsulta);
	intentMap.set("RemarcarConsulta", remarcarConsulta);
	intentMap.set("CancelarConsulta", cancelarConsulta);
	intentMap.set("ConfirmarAcao", confirmarAcao);
	intentMap.set("SolicitarRemarcacao", solicitarRemarcacao);

	agent.handleRequest(intentMap);
}

functions.http("dialogflowWebhook", dialogflowWebhook);
