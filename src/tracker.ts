import { Base, Message, Snowflake } from 'discord.js';
import EventEmitter from 'events';
import {DateTime, Duration, Interval} from 'luxon';

export class TrackerEvents {
    static PeriodCloseOnline = "Tracker.Online.Period.Close";
    static PeriodCloseOffline = "Tracker.Offline.Period.Close";
    static OnlinePeriodEnd = "Tracker.Online.Period.End";
    static OfflinePeriodEnd = "Tracker.Offline.Period.End";
    static PeriodUpdate = "Tracker.Period.Update";
}

enum EventType {
    UserSentMessage,
    UserAddedReaction,
    UserBecameInactive,
    UserVoiceConnected,
    UserVoiceDisconnected,
}

class PeriodEvent {
    userID: Snowflake;
    type: EventType;
    occurred: DateTime;

    constructor(userID: Snowflake, type: EventType, occurred: DateTime){
        this.userID = userID;
        this.type = type;
        this.occurred = occurred;
    }
}


class Period extends EventEmitter {
    start: DateTime;
    end?: DateTime;
    userID: Snowflake;
    events: Array<PeriodEvent>;

    constructor(userID: string){
        super();
        this.start = DateTime.now();
        this.userID = userID;
        this.events = new Array<PeriodEvent>();
        this.on(TrackerEvents.PeriodUpdate, this.updatePeriod);
    }

    get isOpen(): boolean{
        if(this.end){
            return false;
        }
        return true;
    }

    get lastUpdate(): DateTime | undefined {
        const lastEvent = this.events.sort((p1, p2) => {
            return p1.occurred > p2.occurred ? 1 : p1.occurred < p2.occurred ? -1 : 0;
        }).at(-1);
        return lastEvent?.occurred;
    }

    get interval(): Interval {
        return Interval.fromDateTimes(this.start,this.end ?? DateTime.now());
    }

    updatePeriod(event: PeriodEvent){
        this.events.push(event);
    }

    close(){
        if(this.end){
            return;
        }
        this.end = DateTime.now();
    }
}
export class OnlinePeriod extends Period {
    private timer: NodeJS.Timer;
    constructor(userID: string, predicate: (p: Period) => boolean, isOpen = true){
        super(userID);
        this.timer = setInterval(() => {
            if(predicate(this)){
                this.close();
            }
        },100);
        
        this.once(TrackerEvents.OnlinePeriodEnd, () => {
            this.close();
        });
    }
    close(){
        super.close();
        clearInterval(this.timer);
        this.emit(TrackerEvents.PeriodCloseOnline, this);
    }
}

export class OfflinePeriod extends Period {

    constructor(userID: string){
        super(userID);
        this.once(TrackerEvents.OfflinePeriodEnd, () => {
            this.close();
        });
    }

    close() {
        super.close();
        this.emit(TrackerEvents.PeriodCloseOffline, this);
    }
}

export default class Tracker extends EventEmitter {

    private toProcess: Array<PeriodEvent>;
    private onlinePeriods: Array<OnlinePeriod>;
    private offlinePeriods: Array<OfflinePeriod>;
    private periodClosePredicate: (p: Period) => boolean;

    constructor(messageClosePredicate: (p: Period) => boolean){
        super();
        this.toProcess = new Array<PeriodEvent>();
        this.onlinePeriods = new Array<OnlinePeriod>();
        this.offlinePeriods = new Array<OfflinePeriod>();
        this.periodClosePredicate = messageClosePredicate;
    }
    addUserBecameInactive(userID: Snowflake, occurred: DateTime){
        const periodEvent = new PeriodEvent(userID, EventType.UserBecameInactive, occurred);
        this.toProcess.push(periodEvent);
        this.processPeriodEvents();
    }
    addMessage(userID: Snowflake, message: String, occurred: DateTime){
        const periodEvent = new PeriodEvent(userID, EventType.UserSentMessage, occurred);
        this.toProcess.push(periodEvent);
        this.processPeriodEvents();
    }
    addReaction(userID: Snowflake, messageID: Snowflake, reactionID: Snowflake, occurred: DateTime){
        const periodEvent = new PeriodEvent(userID, EventType.UserAddedReaction, occurred);
        this.toProcess.push(periodEvent)
    }
    addVoiceChannelJoin(userID: Snowflake, voiceChannelID: Snowflake, occurred: DateTime){
        const periodEvent = new PeriodEvent(userID, EventType.UserVoiceDisconnected, occurred);
        this.toProcess.push(periodEvent)
    }
    addVoiceChannelLeave(userID: Snowflake, voiceChannelID: Snowflake, occurred: DateTime){
        const periodEvent = new PeriodEvent(userID, EventType.UserVoiceDisconnected, occurred);
        this.toProcess.push(periodEvent)
    }

    processPeriodEvents(){
        let event = this.toProcess.shift();
        while(event !== undefined){
            let onlinePeriod = this.onlinePeriods.find(p => p.isOpen && p.userID === event?.userID) ?? null;
            let offlinePeriod = this.offlinePeriods.find(p => p.isOpen && p.userID === event?.userID) ?? null;
            if(event.type !== EventType.UserBecameInactive && event.type !== EventType.UserVoiceDisconnected){
                if(offlinePeriod !== null){
                    this.closeOfflinePeriod(offlinePeriod, event);
                }
                if(onlinePeriod === null){
                    onlinePeriod = new OnlinePeriod(event.userID,this.periodClosePredicate);
                    onlinePeriod.once(TrackerEvents.PeriodCloseOnline, (p: OnlinePeriod) => {
                        this.addUserBecameInactive(p.userID, DateTime.now());
                        this.emit(TrackerEvents.PeriodCloseOnline, p);
                    });
                    this.onlinePeriods.push(onlinePeriod);
                }
                onlinePeriod.emit(TrackerEvents.PeriodUpdate, event);
            } else {
                if(onlinePeriod !== null){
                    onlinePeriod.emit(TrackerEvents.PeriodUpdate, event);
                    onlinePeriod.emit(TrackerEvents.OnlinePeriodEnd);
                }
                if(offlinePeriod === null){
                    offlinePeriod = new OfflinePeriod(event.userID);
                    offlinePeriod.once(TrackerEvents.PeriodCloseOffline, (p: OfflinePeriod) => {
                        this.emit(TrackerEvents.PeriodCloseOffline, p);
                    });
                    this.offlinePeriods.push(offlinePeriod);
                }
                offlinePeriod.emit(TrackerEvents.PeriodUpdate, event);
            }
            event = this.toProcess.shift();
        }
    }

    closeOfflinePeriod(p: OfflinePeriod, e: PeriodEvent){
        p.emit(TrackerEvents.PeriodUpdate, e);
        p.emit(TrackerEvents.OfflinePeriodEnd);
    }

    closeOnlinePeriod(p: OnlinePeriod, e: PeriodEvent){
        p.emit(TrackerEvents.PeriodUpdate, e);
        p.emit(TrackerEvents.OnlinePeriodEnd);
    }
}