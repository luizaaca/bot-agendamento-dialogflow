const functions = require('@google-cloud/functions-framework');

functions.http('verificarAgendaHttp', (req, res) => {
  const cpf = req.body.queryResult?.parameters?.cpf; // Acesso correto ao CPF vindo do Dialogflow
  const horarios = "hoje às 14h, amanhã às 9h e 11h";
  
  res.json({
    fulfillmentText: `CPF ${cpf} recebido. Horários disponíveis: ${horarios}`
  });
});
