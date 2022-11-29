import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Events, Snowflake, userMention, ChannelType, TextChannel } from 'discord.js';
import Tracker, { OnlinePeriod, OfflinePeriod, TrackerEvents } from './tracker';
import { DateTime } from 'luxon';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const tracker = new Tracker(p => {
    if(p.lastUpdate){
        return p.lastUpdate < DateTime.now().minus({ minutes: parseInt(process.env.MINUTES_INACTIVE ?? "15")})
    }
    return false;
});
tracker.on(TrackerEvents.PeriodCloseOnline, async (p: OnlinePeriod) => {
    const periodDuration = p.interval;
    const notification = `${userMention(p.userID)} was online from ${periodDuration.toFormat("hh:mm:ss")}, and finally went away for a total of ${periodDuration.toDuration().toFormat("hh:mm:ss")}`;
    const notificationChannel = await client.channels.fetch('1034616023640440913');
    if(notificationChannel?.type == ChannelType.GuildText){
        (notificationChannel as TextChannel).send(notification);
    }
});
tracker.on(TrackerEvents.PeriodCloseOffline, async (p: OfflinePeriod) => {
    const periodDuration = p.interval;
    const notification = `${userMention(p.userID)} was offline from ${periodDuration.toFormat("hh:mm:ss")}, for a total of ${periodDuration.toDuration().toFormat("hh:mm:ss")}`;
    const notificationChannel = await client.channels.fetch('1034616023640440913');
    if(notificationChannel?.type == ChannelType.GuildText){
        (notificationChannel as TextChannel).send(notification);
    }
});
client.once(Events.ClientReady, async c => {
    console.log(`Logged in as ${c.user.tag}`);
    const guilds = await c.guilds.fetch();
    for(let [key, guild] of guilds){
        const fullGuild = await guild.fetch();
        console.log(fullGuild.name);
        const guildMembers = await fullGuild.members.fetch();
        for(let [key, member] of guildMembers){
            tracker.addUserBecameInactive(member.user.id, DateTime.now());
        }
    }
});

client.on(Events.MessageCreate, m => {
    if(m.author.id === client.application?.id){
        return;
    }
    let userID = m.author.id;
    let messageContent = m.content;
    const occurred = DateTime.fromJSDate(m.createdAt);
    if(m.author.bot){
        if(m.interaction !== null){
            userID = m.interaction.user.id;
            messageContent = m.interaction.commandName;
        }else {
            return;
        }
    }
    console.log(`New Message from ${m.author.username}`);
    tracker.addMessage(userID, messageContent, occurred);
});

client.login(process.env.CLIENT_TOKEN);