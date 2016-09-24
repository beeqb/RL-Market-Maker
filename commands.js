var Config = require('./config.json');
var _ = require('lodash');
var AuthDetails = require('./auth.json');
var MongoClient = require('mongodb').MongoClient;
var mongoUrl = AuthDetails.mongoUrl;
var db = null;
var buys = null;
var sells = null;

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
    sells.findAndRemove({ expirationTime: { $lt: Date.now() } }).then(function (removed) {
        console.log('removed sales orders');
    });
    buys.findAndRemove({ expirationTime: { $lt: Date.now() } }).then(function (removed) {
        console.log('removed purchase orders');
    });
}

function checkIfSellerHasBuyers(bot, entry, id) {
    var query = getQueryForItemsThatMatch(entry.item);
    query.$and.push({ priceNum: { $gte: entry.priceNum } });
    query.$and.push({ priceType: entry.priceType });
    query.$and.push({ author: { $ne: id } });
    buys.find(query).toArray(function (err, buyers) {
        if (buyers && buyers.length > 0) {
            var message = "Here are the buyers potentially willing to purchase your item:\n" + turnArrayIntoString("buy", buyers);
            bot.users.get(entry.author).sendMessage(message);
        }
        for (var i = 0; i < buyers.length; i++) {
            var c = buyers[i];
            var message = "Someone is willing to sell you an item at your price!\n" +
                "Username: " + entry.username + "#" + entry.discriminator + " is offering " + entry.count + " " + entry.item + " for " + entry.priceNum + " " + entry.priceType + "!";
            bot.users.get(c.author).sendMessage(message);
        }
    });
}

function checkIfBuyerHasSellers(bot, entry, id) {
    var query = getQueryForItemsThatMatch(entry.item);
    query.$and.push({ priceNum: { $lte: entry.priceNum } });
    query.$and.push({ priceType: entry.priceType });
    query.$and.push({ author: { $ne: id } });
    sells.find(query).toArray(function (err, sellers) {
        if (sellers && sellers.length > 0) {
            var message = "Here are the sellers offering the item you seek:\n" + turnArrayIntoString("sell", sellers);
            bot.users.get(entry.author).sendMessage(message);
        }
        for (var i = 0; i < sellers.length; i++) {
            var c = sellers[i];
            var message = "Someone is willing to buy your item at your price!\n" +
                "Username: " + entry.username + "#" + entry.discriminator + " wants " + entry.count + " " + entry.item + " for " + entry.priceNum + " " + entry.priceType + "!";
            bot.users.get(c.author).sendMessage(message);
        }
    });
}

function turnArrayIntoString(type, arr) {
    var retval = "";
    for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        retval += "\tUsername: " + c.username + "#" + c.discriminator + (type === "buy" ? " will pay " : " wants ") + c.priceNum + " " + c.priceType + " for a " + c.item.join(" ") + "\n";
    }
    return retval;
}

var commands = {
    "sell": {
        usage: "<count> <item> @ <asking price>",
        description: "Puts an item for sale. Sale offers expire in **" + Config.expiryString + "**.\n" +
        "<count> is the number of items for sale\n" +
        "<item> is the item name in Rocket League (for example, Merc: Narwhal, Looper, cc1)\n" +
        "<asking price> must be either Keys, CC1, or CC2 (for example, 1 Key or 2 CC2).\n" +
        "__<asking price> is per item.__\n" +
        "<item modifiers> are colors & certifications (for example, 'Certified Juggler, Lime' is a valid modifier).\n",
        process: function (bot, msg, args) {
            if (!msg.guild) {
                msg.channel.sendMessage("Sorry, you need execute this command in a channel to determine which platform it's on.");
                return;
            }
            // Parse options
            if (!check(args, 2)) {
                handleBadCommand(msg, 'sell', args);
                return;
            }

            var count = _.parseInt(args[0].split(" ")[0]);
            if (_.isFinite(count)) {
                item = _.tail(args[0].split(" "));
            } else {
                count = 1;
                item = args[0].split(" ");
            }

            var askingPrice = args[1];

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
                channel: msg.channel.id,
                saleId: saleId,
                count: count,
                item: item,
                priceNum: priceNum,
                priceType: priceType,
                expirationTime: Date.now() + Config.expiryTime,
                author: msg.author.id,
                username: msg.author.username,
                discriminator: msg.author.discriminator
            };

            sells.insert(entry).then(function (added) {
                console.log('Added sale order');
                checkIfEntriesAreExpired();
                checkIfSellerHasBuyers(bot, entry, entry.author);
                msg.channel.sendMessage("Sell order " + saleId + " noted. Buyers will be given your username if they put in a buy order at or above your price.");
            });
        }
    },
    "buy": {
        usage: "<count> <item> @ <buying price>",
        description: "Puts in an purchase order for an item. Purchase orders expire in **" + Config.expiryString + "**.\n" +
        "<item> is the base item name (e.g. 'Looper')\n" +
        "<buying price> must be either Keys, CC1 or CC2.\n" +
        "__<buying price> is per item.__\n" +
        "Item modifiers are colors & certifications.\n",
        process: function (bot, msg, args) {
            if (!msg.guild) {
                msg.channel.sendMessage("Sorry, you need execute this command in a channel to determine which platform it's on.");
                return;
            }
            // Parse options
            if (!check(args, 2)) {
                handleBadCommand(msg, 'buy', args);
                return;
            }

            var count = _.parseInt(args[0].split(" ")[0]);
            if (_.isFinite(count)) {
                item = _.tail(args[0].split(" "));
            } else {
                count = 1;
                item = args[0].split(" ");
            }

            var askingPrice = args[1];

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
                channel: msg.channel.id,
                buyId: buyId,
                count: count,
                item: item,
                priceNum: priceNum,
                priceType: priceType,
                expirationTime: Date.now() + Config.expiryTime,
                author: msg.author.id,
                username: msg.author.username,
                discriminator: msg.author.discriminator
            };

            buys.insert(entry).then(function (itemadded) {
                console.log('Added purchase order');
                checkIfEntriesAreExpired();
                checkIfBuyerHasSellers(bot, entry, entry.author);
                msg.channel.sendMessage("Purchase order " + buyId + " noted. Sellers will be given your username if they offer this item at or below your price.");
            });
        }
    },
    "itemswanted": {
        usage: "",
        description: "PMs you a list of every item type with a purchase order one the Discord exchange. Use !price <item description> to see who's buying and selling that item.",
        process: function (bot, msg, args) {
            if (!msg.guild) {
                msg.channel.sendMessage("Sorry, you need execute this command in a channel to determine which platform it's on.");
                return;
            }
            buys.find({channel:msg.channel.id}).toArray(function (err, buyers) {
                var items = [];
                var message = "Here are the items people want that you can ask for a price check on: [";
                for (var i = 0; i < buyers.length; i++) {
                    if (!_.includes(items, buyers[i].item.join(" "))) {
                        items.push(buyers[i].item.join(" "));
                    }
                }
                message += items.join(", ") + "]";
                msg.author.sendMessage(message);
            });
        }
    },
    "itemsforsale": {
        usage: "",
        description: "PMs you a list of every item type currently for sale on the Discord exchange. Use !price <item description> to see who's buying and selling that item.",
        process: function (bot, msg, args) {
            if (!msg.guild) {
                msg.channel.sendMessage("Sorry, you need execute this command in a channel to determine which platform it's on.");
                return;
            }
            sells.find({channel:msg.channel.id}).toArray(function (err, sellers) {
                var items = [];
                var message = "Here are the items for sale that you can ask for a price check on: [";
                for (var i = 0; i < sellers.length; i++) {
                    if (!_.includes(items, sellers[i].item.join(" "))) {
                        items.push(sellers[i].item.join(" "));
                    }
                }
                message += items.join(", ") + "]";
                msg.author.sendMessage(message);
            });
        }
    },
    "price": {
        usage: "<item description>",
        description: "Lists all items for sale & purchase orders that match each part of the <item description>\n" +
        "**PLEASE NOTE:** the bot does not differentiate between pluralization. For example, !price lime loopers is NOT the same as !price lime looper wheels.\n" +
        "\t\t\t\t\t\t\t Use !itemsforsale or !itemswanted to get a full list of items on the market",
        process: function (bot, msg, args) {
            if (!msg.guild) {
                msg.channel.sendMessage("Sorry, you need execute this command in a channel to determine which platform it's on.");
                return;
            }
            if (args.length !== 1) {
                handleBadCommand(msg, "price", args);
                return;
            }
            var itemarray = args[0].split(" ");
            var query = getQueryForItemsThatMatch(itemarray);
            query.channel = msg.channel.id;
            buys.find(query).sort({ price: -1 }).toArray(function (err, buyers) {
                sells.find(query).sort({ price: 1 }).toArray(function (err2, sellers) {
                    var info = "Price summary for **" + args[0] + "**\n";
                    if (buyers.length === 0) {
                        info += "**Nobody** is currently buying **" + args[0] + "** in this channel\n";
                    } else {
                        info += "Here are the current buyers for **" + args[0] + "** in this channel:\n";
                        for (var i = 0; i < buyers.length; i++) {
                            var c = buyers[i];
                            info += "\t**" + c.username + "#" + c.discriminator + "**: wants " + c.count + " " + c.item.join(" ") + " for " + c.priceNum + " " + c.priceType + "\n";
                        }
                    }
                    if (sellers.length === 0) {
                        info += "\n**Nobody** is currently selling **" + args[0] + "** in this channel";
                    } else {
                        info += "\nHere are the current sellers for **" + args[0] + "** in this channel:\n";
                        for (var i = 0; i < sellers.length; i++) {
                            var c = sellers[i];
                            info += "\t**" + c.username + "#" + c.discriminator + "**: is selling " + c.count + " " + c.item.join(" ") + " for " + c.priceNum + " " + c.priceType + "\n";
                        }
                    }
                    msg.channel.sendMessage(info);
                });
                });
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
                        sells.update({ saleId: args[0] }, { $set: { count: salesOrder.count } }).then(function (rem) {
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
        usage: "<sale ID **or** * >",
        description: "Remove an item you put up for sale from the market.\nYou may use !unsell * to remove all of your items for sale from the market.",
        process: function (bot, msg, args) {
            if (args[0] === "*") {
                sells.remove({ author: msg.author.id }).then(function () {
                    msg.channel.sendMessage('Item(s) removed!');
                });
            } else {
                sells.findAndRemove({ saleId: args[0], author: msg.author.id }).then(function (removed) {
                    if (!removed || !removed.value) {
                        msg.channel.sendMessage('Oops, something went wrong. You likely typed in the wrong sale ID. Check your items for sale with !mysales then try again.');
                    } else {
                        msg.channel.sendMessage('Item removed!');
                    }
                });
            }
        }
    },
    "unbuy": {
        usage: "<buy ID **or** * >",
        description: "Remove a buy order of yours from the market.\nYou may use !unsell * to remove all of your items for sale from the market.",
        process: function (bot, msg, args) {
            if (args[0] === "*") {
                buys.remove({ author: msg.author.id }).then(function () {
                    msg.channel.sendMessage('Item(s) removed!');
                });
            } else {
                buys.findAndRemove({ buyId: args[0], author: msg.author.id }).then(function (removed) {
                    if (!removed || !removed.value) {
                        msg.channel.sendMessage('Oops, something went wrong. You likely typed in the wrong buy ID. Check your items for sale with !mybuys then try again.');
                    } else {
                        msg.channel.sendMessage('Purchase order removed!');
                    }
                });
            }
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
                        message += "\tID: " + c.buyId + ", " + c.item.join(" ") + " for " + c.priceNum + " " + c.priceType + "\n";
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
                        message += "\tID: " + c.saleId + ", " + c.count + " " + c.item.join(" ") + " for " + c.priceNum + " " + c.priceType + "\n";
                    }
                    msg.channel.sendMessage(message);
                }
            });
        }
    }
}

function getQueryForItemsThatMatch(itemarray) {
    var query = { $and: [{ expirationTime: { $gt: Date.now() } }] };
    for (var i = 0; i < itemarray.length; i++) {
        query.$and.push({ 'item': { $elemMatch: { $eq: itemarray[i] } } });
    }
    return query;
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
    if (priceParts[1] === "key") { priceParts[1] = "keys" }
    if (priceParts[1] === "cc1") { priceParts[1] = "cc1s" }
    if (priceParts[1] === "cc2") { priceParts[1] = "cc2s" }
    return { priceNum: priceParts[0], priceType: priceParts[1] };
}

function isValidPrice(rawPriceArg) {
    return /[1-9][0-9]* (?:keys|key|cc1|cc2|cc1s|cc2s)/.test(rawPriceArg);
}

function handleBadCommand(msg, cmdName, args) {
    msg.channel.sendMessage("Sorry, your arguments (" + args.join(" @ ") + ") to " + cmdName + " were not valid. Type !help " + cmdName + " for more info.")
        .then(function (message) {
            message.delete(10000);
        });
}

module.exports = commands;
