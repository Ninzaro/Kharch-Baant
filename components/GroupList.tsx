import React from 'react';
import { Group, Person, GROUP_TYPES } from '../types';
import Avatar from './Avatar';

interface GroupListProps {
    groups: Group[];
    people: Person[];
    selectedGroupId: string | null;
    onSelectGroup: (groupId: string) => void;
    onGoHome: () => void;
}

const GroupListItem: React.FC<{
    group: Group;
    people: Person[];
    isSelected: boolean;
    onSelect: () => void;
}> = ({ group, people, isSelected, onSelect }) => {
    const members = people.filter(p => group.members.includes(p.id));
    const typeLabel = GROUP_TYPES.find(option => option.value === group.groupType)?.label || 'Other';
    const tripRange = group.tripStartDate && group.tripEndDate
        ? `${new Date(group.tripStartDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(group.tripEndDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : null;

    return (
        <li className="mb-2">
            <button
                onClick={onSelect}
                className={`w-full text-left p-3 rounded-lg transition-colors flex flex-col ${
                    isSelected
                        ? 'bg-foreground/10'
                        : 'hover:bg-foreground/5'
                }`}
            >
                <div className="flex items-center gap-2">
                    <span className={`font-semibold ${isSelected ? 'text-foreground' : 'text-foreground'}`}>{group.name}</span>
                    {tripRange && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-foreground/5 px-2 py-0.5 rounded-full border border-border">{tripRange}</span>
                    )}
                </div>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground mt-1">{typeLabel}</span>
                <div className="flex items-center mt-2 -space-x-2">
                    {members.slice(0, 4).map(member => (
                       <Avatar key={member.id} id={member.id} name={member.name} avatarUrl={member.avatarUrl} size="sm" />
                    ))}
                    {members.length > 4 && (
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                            +{members.length - 4}
                        </div>
                    )}
                </div>
            </button>
        </li>
    );
};


const GroupList: React.FC<GroupListProps> = ({ groups, people, selectedGroupId, onSelectGroup, onGoHome }) => {
    return (
        <div className="bg-overlay/20 backdrop-blur-xl border-r border-border text-foreground w-64 p-4 flex-col hidden md:flex">
            <h1 className="text-2xl font-bold mb-6 cursor-pointer text-transparent bg-clip-text bg-gradient-to-br from-primary to-accent" onClick={onGoHome}>Kharch Baant</h1>
            <nav className="flex-grow">
                 <button 
                    onClick={onGoHome}
                    className="w-full text-left p-3 rounded-lg transition-colors flex items-center gap-3 mb-4 font-semibold bg-foreground/5 hover:bg-foreground/10"
                >
                    <span>Dashboard</span>
                </button>
                <ul>
                    {groups.map(group => (
                        <GroupListItem
                            key={group.id}
                            group={group}
                            people={people}
                            isSelected={selectedGroupId === group.id}
                            onSelect={() => onSelectGroup(group.id)}
                        />
                    ))}
                </ul>
            </nav>
            <button
                className="w-full bg-gradient-to-br from-success to-success hover:from-emerald-600 hover:to-teal-700 text-foreground font-bold py-2 px-4 rounded-lg transition-colors mt-4"
            >
                Add New
            </button>
        </div>
    );
};

export default GroupList;
