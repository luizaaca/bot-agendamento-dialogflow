const functions = require("@google-cloud/functions-framework");
const dialogflow = require("@google-cloud/dialogflow");
const { WebhookClient, Suggestion } = require("dialogflow-fulfillment");
const CalendarService = require("./calendarService");
const { DateTime } = require("luxon");

async function dialogflowWebhook(req, res) {
   if (req.body.originalDetectIntentRequest) {
      console.log(
         `Interceptando chamada do Console do Dialogflow com originalDetectIntentRequest.source: ${req.body.originalDetectIntentRequest.source}`
      );
      req.body.originalDetectIntentRequest = {}; // Limpa o source para evitar problemas com o Dialogflow Console
   }
   const agent = new WebhookClient({ request: req, response: res });

   // Função para o Default Welcome Intent
   function welcome(agent) {
      console.log("[Welcome] Dados coletados:", agent.parameters);

      // Envia a pergunta inicial para o usuário
      agent.add(
         "Olá! Por favor informe seu nome completo e CPF para que eu possa verificar suas consultas."
      );
      // Não adicione contextos de saída aqui, o usuário responderá a outro Intent
   }

   // Função para o Coletar Dados Iniciais
   async function coletarDadosIniciais(agent) {
      const nomeCompleto = agent.parameters.paciente?.name;
      let cpf = agent.parameters.cpf;

      console.log("[ColetarDadosIniciais] Dados coletados:", agent.parameters);

      if (!nomeCompleto || !cpf) {
         agent.add(
            "Desculpe, não consegui entender seu nome completo ou CPF. Por favor, tente novamente."
         );
         // Não adicione contextos de saída para manter o usuário neste fluxo de coleta.
         return; // Interrompe a execução para que o Dialogflow espere uma nova entrada.
      }

      // Remove caracteres não numéricos do CPF
      cpf = cpf.replace(/\D/g, "");

      if (cpf.length !== 11) {
         agent.add("Por favor, informe um CPF válido com 11 dígitos.");
         return;
      }

      try {
         const consultas = await CalendarService.verificarAgendamentoExistente(
            nomeCompleto,
            cpf
         );

         if (consultas && consultas.length > 0) {
            // Monta a mensagem com as consultas
            let mensagem = `Encontrei a(s) seguinte(s) consulta(s) para você:\n\n`;
            consultas.forEach((consulta) => {
               mensagem += `- ${consulta.inicio
                  .setLocale("pt-BR")
                  .toFormat("dd/MM/yyyy [às] HH:mm")}\n`; // Removido (consulta.tipo) pois não está no objeto retornado
            });
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
               lifespan: 1, // Contexto ativo por 5 turnos de conversa
               parameters: agent.parameters, // Passa os dados e consultas para os próximos intents
            });

            // Dispara um evento para o Dialogflow saber que consultas foram encontradas (opcional, mas bom para Intents baseados em evento)
            // agent.setFollowupEvent("consultas_encontradas");
         } else {
            // Nenhuma consulta encontrada
            agent.add(
               `Não encontrei nenhuma consulta marcada para ${nomeCompleto} com o CPF ${cpf}.`
            );
            console.log(
               `Nenhuma consulta encontrada para ${nomeCompleto} com CPF ${cpf}`
            );
            agent.add("Você gostaria de marcar uma nova consulta?");

            // Adiciona a opção como chip
            agent.add(new Suggestion("Marcar nova consulta"));

            // Ativa o contexto para o próximo Intent
            agent.setContext({
               name: "flow_sem_consulta_context",
               lifespan: 1,
               parameters: agent.parameters, // Passa os dados para o próximo intent
            });

            // Dispara um evento
            //agent.setFollowupEvent("nenhuma_consulta_encontrada");
         }
      } catch (error) {
         console.error("Erro ao verificar consultas:", error);
         agent.add(
            "Desculpe, tive um problema ao verificar suas consultas. Por favor, tente novamente mais tarde."
         );
         // Não defina contextos de saída se houver erro grave
      }
   }

   // Função para marcar uma nova consulta, apresentando os horários disponíveis
   async function novaConsulta(agent) {
      const context = agent.getContext("flow_sem_consulta_context");

      const nomeCompleto = context.parameters.paciente?.name;
      const cpf = context.parameters.cpf;

      console.log("[NovaConsulta] Dados coletados:", { nomeCompleto, cpf });

      if (!nomeCompleto || !cpf) {
         agent.add(
            "Desculpe, não consegui entender seu nome completo ou CPF. Por favor, tente novamente."
         );
         return; // Interrompe a execução para que o Dialogflow espere uma nova entrada.
      }
      // Remove caracteres não numéricos do CPF
      const cpfLimpo = cpf.replace(/\D/g, "");
      if (cpfLimpo.length !== 11) {
         agent.add("Por favor, informe um CPF válido com 11 dígitos.");
         return;
      }
      try {
         // Verifica se já existe uma consulta agendada
         const consultasExistentes =
            await CalendarService.verificarAgendamentoExistente(
               nomeCompleto,
               cpfLimpo
            );

         if (consultasExistentes && consultasExistentes.length > 0) {
            agent.add(
               `Você já possui uma consulta agendada para ${nomeCompleto} com o CPF ${cpfLimpo}.`
            );
            return; // Interrompe a execução, pois não é necessário marcar nova consulta
         }

         const horariosDisponiveis =
            await CalendarService.obterHorariosDisponiveis(); // obterHorariosDisponiveis é async

         // Substituir a lista numerada por chips
         agent.add(
            `Olá ${nomeCompleto}, por favor, escolha um horário disponível abaixo:`
         );

         // Adiciona cada horário disponível como um chip
         horariosDisponiveis.forEach((horario) => {
            agent.add(new Suggestion(horario));
         });

         // Ativa o contexto para o próximo Intent de confirmação de agendamento
         agent.setContext({
            name: "flow_nova_consulta_horarios_context",
            lifespan: 1,
            parameters: {
               nomeCompleto,
               cpf: cpfLimpo,
               horariosDisponiveis: horariosDisponiveis, // Passa o array de horários
            },
         });

         //  // Dispara um evento
         //  agent.setFollowupEvent("nova_consulta_agendada");
      } catch (error) {
         console.error("Erro ao iniciar marcação de nova consulta:", error);
         agent.add(
            "Desculpe, tive um problema ao tentar marcar uma nova consulta. Por favor, tente novamente mais tarde."
         );
      }
   }

   // Mapeamento de Intents para funções
   let intentMap = new Map();
   intentMap.set("Default Welcome Intent", welcome);
   intentMap.set("ColetarDados", coletarDadosIniciais);
   intentMap.set("AgendarConsulta", novaConsulta); // Função para marcar nova consulta
   intentMap.set("InformarHorario", (agent) => {
      console.log("[InformarHorario] Dados coletados:", agent.parameters);
      agent.add("Hello baby!");
   });
   // Adicione mais mapeamentos para os intents de "Consultas Encontradas" e "Nenhuma Consulta Encontrada" se precisar de lógica extra neles
   // Por exemplo, se Consultas Encontradas precisar formatar a mensagem de forma diferente ou lidar com o que o usuário diz em seguida:
   // intentMap.set('Consultas Encontradas', handleConsultasEncontradas);
   // intentMap.set('Nenhuma Consulta Encontrada', handleNenhumaConsultaEncontrada);

   agent.handleRequest(intentMap);
}

functions.http("dialogflowWebhook", dialogflowWebhook);
