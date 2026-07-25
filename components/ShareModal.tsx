
import React from 'react';
import BaseModal from './BaseModal';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageDataUrl: string;
    groupName: string;
}

const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, imageDataUrl, groupName }) => {
    if (!isOpen) return null;

    const canShare = typeof navigator.share === 'function';

    const dataURLtoFile = (dataurl: string, filename: string): File | null => {
        const arr = dataurl.split(',');
        if (arr.length < 2) { return null; }
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) { return null; }
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: mime });
    };

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = imageDataUrl;
        link.download = `summary-${groupName.toLowerCase().replace(/\s+/g, '-')}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleShare = async () => {
        const filename = `summary-${groupName.toLowerCase().replace(/\s+/g, '-')}.png`;
        const imageFile = dataURLtoFile(imageDataUrl, filename);
        
        if (imageFile && canShare) {
            const shareData = {
                files: [imageFile],
                title: `${groupName} Expense Summary`,
                text: `Here is the expense summary for our group: ${groupName}.`,
            };
            try {
                if (navigator.canShare && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                } else {
                    // Fallback for browsers that don't support `canShare` or can't share files
                    await navigator.share({ title: shareData.title, text: shareData.text });
                }
            } catch (error) {
                console.error('Sharing failed:', error);
                alert('Could not share the summary. Please try downloading it instead.');
            }
        } else {
            alert('Sharing is not supported on this browser. Please download the image.');
        }
    };


    return (
        <BaseModal
            open={isOpen}
            onClose={onClose}
            title="Share Summary"
            size="md"
            description={<span className="text-muted-foreground text-sm">Download or share the generated expense summary image.</span>}
            footer={
                <div className="flex flex-col sm:flex-row justify-end gap-3 w-full">
                    <button onClick={handleDownload} className="px-4 py-2 bg-sky-600 text-foreground rounded-md hover:bg-sky-500 order-2 sm:order-1">Download Image</button>
                    {canShare && (
                        <button onClick={handleShare} className="px-4 py-2 bg-success text-success-foreground rounded-md hover:bg-success order-3 sm:order-2">Share via...</button>
                    )}
                    <button onClick={onClose} className="px-4 py-2 bg-foreground/10 text-foreground rounded-md hover:bg-foreground/20 order-1 sm:order-3">Close</button>
                </div>
            }
        >
            <div className="text-center">
                <div className="bg-overlay/20 p-2 rounded-lg mb-6">
                    <img src={imageDataUrl} alt="Expense Summary" className="max-w-full h-auto rounded-md mx-auto" />
                </div>
            </div>
        </BaseModal>
    );
};

export default ShareModal;