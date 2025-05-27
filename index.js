const functions = require("@google-cloud/functions-framework");
const dialogflow = require("@google-cloud/dialogflow");
const { WebhookClient, Suggestion } = require("dialogflow-fulfillment");
const CalendarService = require("./calendarService");

async function dialogflowWebhook(req, res) {
   const agent = new WebhookClient({ request: req, response: res });

   // Função para o Default Welcome Intent
   function welcome(agent) {
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

      console.log("Dados coletados:", { nomeCompleto, cpf });

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
               mensagem += `- ${moment(consulta.data).format(
                  "DD/MM/YYYY [às] HH:mm"
               )} (${consulta.tipo})\n`;
            });
            mensagem +=
               "\nVocê deseja remarcar ou cancelar essa consulta?";

            agent.add(mensagem);

            // Adiciona as opções como chips
            agent.add(new Suggestion("Remarcar consulta"));
            agent.add(new Suggestion("Cancelar consulta"));
            agent.add(new Suggestion("Reiniciar agendamento"));

            // Ativa o contexto para os próximos Intents
            agent.setContext({
               name: "flow_consulta_encontrada_context",
               lifespan: 5, // Contexto ativo por 5 turnos de conversa
               parameters: {
                  nomeCompleto: nomeCompleto,
                  cpf: cpf,
                  consultas: consultas,
               }, // Passa os dados e consultas para os próximos intents
            });

            // Dispara um evento para o Dialogflow saber que consultas foram encontradas (opcional, mas bom para Intents baseados em evento)
            // agent.setFollowupEvent("consultas_encontradas");
         } else {
            // Nenhuma consulta encontrada
            agent.add(
               `Não encontrei nenhuma consulta marcada para ${nomeCompleto} com o CPF ${cpf}.`
            );
            agent.add("Você gostaria de marcar uma nova consulta?");

            // Adiciona a opção como chip
            agent.add(new Suggestion("Marcar nova consulta"));

            // Ativa o contexto para o próximo Intent
            agent.setContext({
               name: "flow_sem_consulta_context",
               lifespan: 5, // Contexto ativo por 5 turnos de conversa
               parameters: { nomeCompleto: nomeCompleto, cpf: cpf }, // Passa os dados para o próximo intent
            });

            // Dispara um evento
            agent.setFollowupEvent("nenhuma_consulta_encontrada");
         }
      } catch (error) {
         console.error("Erro ao verificar consultas:", error);
         agent.add(
            "Desculpe, tive um problema ao verificar suas consultas. Por favor, tente novamente mais tarde."
         );
         // Não defina contextos de saída se houver erro grave
      }
   }

   // Mapeamento de Intents para funções
   let intentMap = new Map();
   intentMap.set("WelcomeIntent", welcome);
   intentMap.set("ColetarDados", coletarDadosIniciais);
   // Adicione mais mapeamentos para os intents de "Consultas Encontradas" e "Nenhuma Consulta Encontrada" se precisar de lógica extra neles
   // Por exemplo, se Consultas Encontradas precisar formatar a mensagem de forma diferente ou lidar com o que o usuário diz em seguida:
   // intentMap.set('Consultas Encontradas', handleConsultasEncontradas);
   // intentMap.set('Nenhuma Consulta Encontrada', handleNenhumaConsultaEncontrada);

   agent.handleRequest(intentMap);

   // const intent = req.body.queryResult.intent.displayName;
   // const params = req.body.queryResult.parameters;
   // const cpf = params?.cpf;
   // const nome = params?.nome;

   // switch (intent) {
   //   case "ColetarDados":
   //     try {
   //       const horarios = await obterHorariosDisponiveis();
   //       return res.json({
   //         fulfillmentText: `Olá ${nome}. Aqui estão os horários disponíveis: ${horarios.join(', ')}`
   //       });
   //     } catch (err) {
   //       console.error(err);
   //       return res.json({ fulfillmentText: "Ocorreu um erro ao acessar a agenda." });
   //     }

   //   case "AgendarConsulta":
   //     // Grava agendamento
   //     if (!cpf) {
   //       return res.json({ fulfillmentText: "Por favor, informe seu CPF para continuar." });
   //     }
   //     return res.json({
   //       fulfillmentText: `Consulta agendada para ${params.data} às ${params.hora}`
   //     });

   //   case "CancelarAgendamento":
   //     // Cancela o agendamento do paciente
   //     return res.json({
   //       fulfillmentText: "Sua consulta foi cancelada com sucesso."
   //     });

   //   case "ConsultarAgendamento":
   //     // Mostra agendamento atual
   //     return res.json({
   //       fulfillmentText: "Sua próxima consulta é na sexta às 14h."
   //     });

   //   default:
   //     return res.json({
   //       fulfillmentText: "Desculpe, não entendi a solicitação."
   //     });
   //}
}

functions.http("dialogflowWebhook", dialogflowWebhook);
