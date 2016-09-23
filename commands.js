var Config = require('./config.json');
var _ = require('lodash');
var AuthDetails = require('./auth.json');
var MongoClient = require('mongodb').MongoClient;
var mongoUrl = AuthDetails.mongoUrl;
var db = null;
var buys = null;
var sells = null;

var VALID_PRICE = ['keys', 'cc1', 'cc2'];

MongoClient.connect(mongoUrl, function (err, dbconnected) {
    if (err) {
        console.log(err);
    } else {
        console.log('Mongo connected!');
        db = dbconnected;
        buys = db.collection("Buys");
        sells = db.collection("Sells");
    }
});

function checkIfEntriesAreExpired() {
    sells.findAndRemove({ expirationTime: { $lt: Date.now() } }).then(function(removed) {
        console.log(removed);
        console.log('removed sales orders');
    });
    buys.findAndRemove({ expirationTime: { $lt: Date.now() } }).then(function(removed) {
        console.log(removed);
        console.log('removed purchase orders');
    });
}

function checkIfSellerHasBuyers(bot, entry, id) {
    buys.find({ priceNum: { $gt: entry.priceNum }, priceType: entry.priceType }).toArray(function (err, buyers) {
        if (buyers && buyers.length > 0) {
            var message = "Here are the buyers potentially willing to purchase your item:\n" + turnArrayIntoString("buy", buyers);
            console.log(id);
            bot.users.get(id).sendMessage(message);
        }
    });
}

function checkIfBuyerHasSellers(bot, entry, msg) {
    sells.find({ priceNum: { $lt: entry.priceNum }, priceType: entry.priceType }).toArray(function (err, sellers) {
        if (sellers && sellers.length > 0) {
            var message = "Here are the sellers offering the item you seek:\n" + turnArrayIntoString("sell", sellers);
            bot.users.get(id).sendMessage(message);
        }
    });
}

function turnArrayIntoString(type, arr) {
    var retval = "";
    for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        retval += "\tUsername: " + c.username + "#" + c.discriminator + (type === "buy" ? " will pay " : " wants ") + c.priceNum + " " + c.priceType + " for a " + c.item + 
            (c.modifiers.length > 0 ? (" with modifiers: " + c.modifiers) : "") + "\n";
    }
    return retval;
}

var commands = {
    "sell": {
        usage: "<count>, <item>, <asking price>, [OPTIONAL] <comma-separated item modifiers>",
        description: "Puts an item for sale. Sale offer expires in " + Config.expiryString + ".\n" +
        "<count> is the number of items for sale\n" +
        "<item> is the item name in Rocket League (for example, Merc: Narwhal, Looper, cc1)\n" +
        "<asking price> must be either Keys, CC1, or CC2 (for example, 1 Key or 2 CC2).\n" +
        "<item modifiers> are colors & certifications (for example, 'Certified Juggler, Lime' is a valid modifier).\n",
        process: function (bot, msg, args) {
            // Parse options
            if (!check(args, 3)) {
                handleBadCommand(msg, 'sell', args);
                return;
            }

            const [count, item, askingPrice, ...modifiers] = args;
            if (!isValidPrice(askingPrice)) {
                handleBadCommand(msg, 'sell', args);
                return;
            }

            var {priceNum, priceType} = getPriceObject(askingPrice);
            var saleId = 'xxxxx'.replace(/[x]/g, function (c) {
                var r = Math.random() * 10 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(10);
            });
            var entry = {
                saleId: saleId,
                count: count,
                item: item,
                priceNum: priceNum,
                priceType: priceType,
                modifiers: modifiers,
                expirationTime: Date.now() + Config.expiryTime,
                author: msg.author.id,
                username: msg.author.username,
                discriminator: msg.author.discriminator
            };

            sells.insert(entry).then(function(added) {
                console.log(added);
                checkIfEntriesAreExpired();
                checkIfSellerHasBuyers(bot, entry, msg.author.id);
                msg.channel.sendMessage("Sell order " + saleId + " noted. Buyers will be given your username if they put in a buy order at or above your price.");
            });
        }
    },
    "buy": {
        usage: "<item>, <buying price>, [OPTIONAL] <comma-separated item modifiers>",
        description: "Puts in an order to buy an item for sale.\n" +
        "<item> is the base item name (e.g. 'Looper')\n" +
        "<buying price> must be either Keys, CC1 or CC2.\n" +
        "Item modifiers are colors & certifications.\n",
        process: function (bot, msg, args) {
            if (!check(args, 2)) {
                handleBadCommand(msg, 'buy', args);
                return;
            }

            const [item, askingPrice, ...modifiers] = args;
            if (!isValidPrice(askingPrice)) {
                handleBadCommand(msg, 'buy', args);
                return;
            }

            const {priceNum, priceType} = getPriceObject(askingPrice);

            const buyId = 'xxxxx'.replace(/[x]/g, function (c) {
                var r = Math.random() * 10 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(10);
            });

            const entry = {
                buyId: buyId,
                item: item,
                priceNum: priceNum,
                priceType: priceType,
                modifiers: modifiers,
                expirationTime: Date.now() + Config.expiryTime,
                author: msg.author.id,
                username: msg.author.username,
                discriminator: msg.author.discriminator
            };

            buys.insert(entry).then(function(itemadded) {
                checkIfEntriesAreExpired();
                checkIfBuyerHasSellers(bot, entry, msg.author.id);
                msg.channel.sendMessage("Purchase order " + buyId + " noted. Sellers will be given your username if they offer this item at or below your price.");
            });
        }
    },
    "price": {
        usage: "<item>",
        description: "Lists all items for sale & purchase orders that match the <item>",
        process: function (bot, msg, args) {
            if (args.length !== 1) {
                handleBadCommand(msg, "price", args);
            } else {
                var query = { expirationTime: { $gt: Date.now() } };
                query.item = args[0];
                buys.find(query).sort({ price: -1 }).toArray(function (err,buyers) {
                    sells.find(query).sort({ price: 1 }).toArray(function (err,sellers) {
                        var info = "";
                        if (buyers.length === 0) {
                            info += "Nobody is currently buying " + args[0] + "\n";
                        } else {
                            var info = "Here are the current buyers for " + args[0] + ":\n";
                            for (var i = 0; i < buyers.length; i++) {
                                var c = buyers[i];
                                info += c.username + "#" + c.discriminator + ": " + c.priceNum + " " + c.priceType + " for " + c.item + " " + c.itemType + " " + c.modifiers + "\n";
                            }
                        }
                        if (sellers.length === 0) {
                            info += "Nobody is currently selling " + args[0];
                        } else {
                            var info = "Here are the current sellers for " + args[0] + ":\n";
                            for (var i = 0; i < sellers.length; i++) {
                                var c = sellers[i];
                                info += c.username + "#" + c.discriminator + ": " + c.priceNum + " " + c.priceType + " for " + c.item + " " + c.itemType + " " + c.modifiers;
                            }
                        }
                        msg.channel.sendMessage(info);
                    });
                });
            }
        }
    },
    "uptime": {
        usage: "",
        description: "The amount of time since the bot last booted",
        process: function (bot, msg, suffix) {
            var now = Date.now();
            var msec = now - bot.startTime;
            var days = Math.floor(msec / 1000 / 60 / 60 / 24);
            msec -= days * 1000 * 60 * 60 * 24;
            var hours = Math.floor(msec / 1000 / 60 / 60);
            msec -= hours * 1000 * 60 * 60;
            var mins = Math.floor(msec / 1000 / 60);
            msec -= mins * 1000 * 60;
            var secs = Math.floor(msec / 1000);
            var timestr = "";
            timestr += days > 0 ? days + " days " : "";
            timestr += hours > 0 ? hours + " hours " : "";
            timestr += mins > 0 ? mins + " minutes " : "";
            timestr += secs > 0 ? secs + " seconds " : "";
            msg.channel.sendMessage("Uptime: " + timestr).then(function (message) { message.delete(10000) });
        }
    },
    "decrement": {
        usage: "<sale ID>",
        description: "Decrement the number of one particular item you put up for sale from the market.\n",
        process: function (bot, msg, args) {
            sells.findOne({ saleId: args[0], author: msg.author.id }).then(function (salesOrder) {
                if (salesOrder) {
                    if (salesOrder.count === 1) {
                        sells.remove({ saleId: args[0] }).then(function (rem) {
                            msg.channel.sendMessage('You had only one ' + salesOrder.item + ' left for sale, so the sales order was removed.');
                        })
                    } else {
                        salesOrder.count = salesOrder.count - 1;
                        sells.update({saleId:args[0]}, {$set: {count:salesOrder.count}}).then(function(rem) {
                            msg.channel.sendMessage('You now only have ' + salesOrder.count + ' ' + salesOrder.item + (salesOrder.count > 1 ? "s" : "") + ' for sale.');
                        })
                    }
                } else {
                    msg.channel.sendMessage('Oops, something went wrong. You likely typed in the wrong sale ID. Check your items for sale with !mysales then try again.');
                }
            });

        }
    },
    "unsell": {
        usage: "<sale ID>",
        description: "Remove an item you put up for sale from the market.\n",
        process: function (bot, msg, args) {
            sells.findAndRemove({ saleId: args[0], author: msg.author.id }).then(function (removed) {
                if (!removed || !removed.value) {
                    msg.channel.sendMessage('Oops, something went wrong. You likely typed in the wrong sale ID. Check your items for sale with !mysales then try again.');
                } else {
                    msg.channel.sendMessage('Item removed!');
                }
            });
        }
    },
    "unbuy": {
        usage: "<buy ID>",
        description: "Remove an buy order of yours from the market.\n",
        process: function(bot, msg, args) {
            buys.findAndRemove({ buyId: args[0], author: msg.author.id }).then(function (removed) {
                 if (!removed || !removed.value) {
                    msg.channel.sendMessage('Oops, something went wrong. You likely typed in the wrong buy ID. Check your items for sale with !mybuys then try again.');
                } else {
                    msg.channel.sendMessage('Purchase order removed!');
                }
            });
        }
    },
    "mybuys": {
        usage: "",
        description: "Lists all purchase orders created by you.",
        process: function (bot, msg) {
            checkIfEntriesAreExpired();
            buys.find({ author: msg.author.id }).toArray(function (err, buylist) {
                if (buylist.length === 0) {
                    msg.channel.sendMessage('You have no purchase orders in the system.');
                } else {
                    var message = "Here are your purchase orders: \n";
                    for (var i = 0; i < buylist.length; i++) {
                        var c = buylist[i];
                        message += "\tID: " + c.buyId + ", " + c.item + (c.modifiers.length > 0 ? " with modifiers " + c.modifiers : "") + " for " + c.priceNum + " " + c.priceType + "\n";
                    }
                    msg.channel.sendMessage(message);
                }
            });
        }
    },
    "mysales": {
        usage: "",
        description: "Lists all items for sale by you.",
        process: function (bot, msg) {
            checkIfEntriesAreExpired();
            sells.find({ author: msg.author.id }).toArray(function (err, selllist) {
                if (selllist.length === 0) {
                    msg.channel.sendMessage('You have no items for sale in the system.');
                } else {
                    var message = "Here are your items for sale: \n";
                    for (var i = 0; i < selllist.length; i++) {
                        var c = selllist[i];
                        message += "\tID: " + c.saleId + ", " + c.count + " " + c.item + (c.count > 1 ? "s" : "") + (c.modifiers.length > 0 ? " with modifiers " + c.modifiers : "") + " for " + c.priceNum + " " + c.priceType + "\n";
                    }
                    msg.channel.sendMessage(message);
                }
            });
        }
    }
}

function getArgsAsArray(args) {
    return args && _.split(args, ", ");
}

function getArgsAsArrayAndCheck(args, min, max) {
    const argsAsArray = getArgsAsArray(args);
    if (!argsAsArray || (min != null && argsAsArray.length < min) || (max != null && argsAsArray.length > max)) {
        return false;
    }

    return argsAsArray;
}

function check(args, min, max) {
    return (min == null || args.length >= min) && (max == null || args.length <= max);
}

function getPriceObject(rawPriceArg) {
    var priceParts = _.split(rawPriceArg, " ");
    if(priceParts[1] === "key") {priceParts[1] = "keys"}
    return { priceNum: priceParts[0], priceType: priceParts[1] };
}

function isValidPrice(rawPriceArg) {
    return /[1-9][0-9]* (?:keys|key|cc1|cc2)/.test(rawPriceArg);
}

function handleBadCommand(msg, cmdName, args) {
    msg.channel.sendMessage("Sorry, your arguments (" + args + ") to " + cmdName + " were not valid. Type !help " + cmdName + " for more info.")
        .then(function (message) {
            message.delete(10000);
        });
}

module.exports = commands;
