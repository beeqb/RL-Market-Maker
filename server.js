var Discord = require("discord.js");
var bot = new Discord.Client();
var AuthDetails = require("./auth.json");
var Config = require("./config.json");
var Commands = require('./commands.js');

bot.on('ready', function() {
    console.log('I am ready');
    console.log(bot.user);
    console.log("Ready to begin! Serving in " + bot.channels.length + " channels");
    bot.user.setStatus("online",Config.CommandPrefix+"help");
});

bot.on("message", checkMessageForCommand);
bot.on("messageUpdate", function(oldM, newM) {checkMessageForCommand(newM)});

function checkMessageForCommand(msg) {
    if(msg.author.id !== bot.user.id && msg.content[0] === Config.CommandPrefix) {
        console.log('Treating ' + msg.content + " from " + msg.author + " as command");
        var cmdName = msg.content.split(" ")[0].substring(1).toLowerCase();
        var args = msg.content.substring(cmdName.length + 2); // add on the ! and " "
        var cmd = Commands[cmdName]; 
        if(cmdName === "help") {
            var info = "";
            if(args) {
                var cmdName2 = args.split(" ")[0].toLowerCase();
                var commandToInterpret = Commands[cmdName2];
                if(commandToInterpret) {
                    info += "Additional information for " + Config.CommandPrefix + cmdName2 + "\n";
                    info += "Usage: " + Config.CommandPrefix + cmdName2 + " " + commandToInterpret.usage + "\n";
                    info += "Description:\n" + commandToInterpret.description;
                    msg.author.sendMessage(info);
                } 
            } else {
                info += "Here are the commands I know:\n";
                for(var c in Commands) {
                    info += Config.CommandPrefix + c + " " + Commands[c].usage + "\n";
                }
                info += "For more detail on any of these commands, type !help <commandname>\n";
                msg.author.sendMessage(info);
            }
        } else if(cmd) {
            console.log('Executing ' + cmdName + ' with args ' + args);
            cmd.process(bot, msg, args);
        } else {
            msg.channel.sendMessage(cmdName + " is not a known command. :(").then(function(message) {message.delete(5000);});
        }
    }
}

bot.login(AuthDetails.token);