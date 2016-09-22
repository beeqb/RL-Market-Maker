var Discord = require("discord.js");
var bot = new Discord.Client();
var AuthDetails = require("./auth.json");
var Config = require("./config.json");
var MongoClient = require('mongodb').MongoClient;
var url = AuthDetails.mongoUrl;
var Commands = require('./commands.js');

bot.on('ready', function() {
    console.log('I am ready');
    console.log(bot.user);
    console.log("Ready to begin! Serving in " + bot.channels + " channels");
    bot.user.setStatus("online",Config.CommandPrefix+"help");
});

bot.on("message", function(msg) {console.log(msg)});
bot.on

bot.login(AuthDetails.token);