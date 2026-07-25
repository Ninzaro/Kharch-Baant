import React, { useState, useMemo } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons/Icons';

interface CalendarModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDateSelect: (date: string) => void;
    selectedDate: string; // YYYY-MM-DD
}

const CalendarModal: React.FC<CalendarModalProps> = ({ isOpen, onClose, onDateSelect, selectedDate }) => {
    const initialDate = new Date(selectedDate + 'T00:00:00');
    const [currentMonth, setCurrentMonth] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));

    const calendarGrid = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const days = [];
        // Add empty cells for days before the start of the month
        for (let i = 0; i < firstDayOfMonth; i++) {
            days.push(null);
        }
        // Add days of the month
        for (let i = 1; i <= daysInMonth; i++) {
            days.push(new Date(year, month, i));
        }
        return days;
    }, [currentMonth]);

    const handlePrevMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };
    
    const handleDateClick = (day: Date) => {
        onDateSelect(day.toISOString().split('T')[0]);
        onClose();
    };

    if (!isOpen) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const selDate = new Date(selectedDate + 'T00:00:00');

    return (
        <div className="fixed inset-0 bg-overlay/70 flex items-center justify-center z-[60] p-4">
            <div className="bg-card/60 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-foreground">
                        {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </h2>
                    <div className="flex gap-2">
                        <button onClick={handlePrevMonth} className="p-1 rounded-full hover:bg-foreground/10 text-muted-foreground hover:text-foreground"><ChevronLeftIcon /></button>
                        <button onClick={handleNextMonth} className="p-1 rounded-full hover:bg-foreground/10 text-muted-foreground hover:text-foreground"><ChevronRightIcon /></button>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => <div key={day}>{day}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {calendarGrid.map((day, index) => (
                        <div key={index} className="w-full aspect-square flex items-center justify-center">
                            {day ? (
                                <button
                                    onClick={() => handleDateClick(day)}
                                    className={`w-full h-full rounded-full transition-colors text-sm
                                        ${selDate.getTime() === day.getTime() ? 'bg-primary text-primary-foreground font-bold' : ''}
                                        ${selDate.getTime() !== day.getTime() && today.getTime() === day.getTime() ? 'border border-border' : ''}
                                        ${selDate.getTime() !== day.getTime() ? 'hover:bg-foreground/10' : ''}
                                    `}
                                >
                                    {day.getDate()}
                                </button>
                            ) : <div />}
                        </div>
                    ))}
                </div>
                <div className="mt-6 flex justify-end">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20">Close</button>
                </div>
            </div>
        </div>
    );
};

export default CalendarModal;